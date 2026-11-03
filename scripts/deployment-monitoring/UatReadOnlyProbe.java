import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Set;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.io.ByteArrayOutputStream;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.net.URI;
import javax.net.ssl.HttpsURLConnection;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.atomic.AtomicBoolean;
import com.microsoft.sqlserver.jdbc.SQLServerDataSource;
import com.microsoft.sqlserver.jdbc.SqlAuthenticationToken;
import com.microsoft.aad.msal4j.PublicClientApplication;
import com.microsoft.aad.msal4j.InteractiveRequestParameters;
import com.microsoft.aad.msal4j.IAuthenticationResult;
import java.util.logging.Level;
import java.util.logging.Logger;

// Prepared for review only. No arbitrary SQL or source-table row discovery.
// ApplicationIntent is routing intent, NOT SELECT-only permission enforcement.
class UatReadOnlyProbe {
    private static final String[] METADATA_NAMES = {"columns", "indexes", "permissions"};
    private static final String[] METADATA_SQL = {
        """
        SELECT c.column_id, c.name, t.name AS type_name,
               CASE WHEN t.name IN ('nvarchar','nchar') AND c.max_length > 0
                    THEN c.max_length / 2 ELSE c.max_length END AS declared_length,
               c.is_nullable, c.is_identity, c.precision, c.scale
        FROM sys.columns AS c
        JOIN sys.types AS t ON t.user_type_id = c.user_type_id
        WHERE c.object_id = OBJECT_ID(?)
        ORDER BY c.column_id
        """,
        """
        SELECT i.name, i.is_unique, i.is_primary_key, i.type_desc,
               i.is_disabled, i.has_filter,
               ic.key_ordinal, ic.is_included_column, c.name AS column_name
        FROM sys.indexes AS i
        JOIN sys.index_columns AS ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
        JOIN sys.columns AS c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
        WHERE i.object_id = OBJECT_ID(?)
        ORDER BY i.index_id, ic.index_column_id
        """,
        "SELECT permission_name FROM fn_my_permissions(?, N'OBJECT') ORDER BY permission_name"
    };

    private static final String[] SEMANTICS_NAMES = {"extended_properties", "foreign_keys"};
    private static final String[] SEMANTICS_SQL = {
        """
        SELECT ep.minor_id, c.name AS column_name, ep.name AS property_name,
               CASE WHEN ep.name IN (N'MS_Description',N'Description',N'Timezone',
                    N'TimeZone',N'StatusMapping',N'DeployTypeMapping',N'GetTypeMapping',N'PriorityMapping')
                    THEN CONVERT(nvarchar(4000), ep.value) ELSE NULL END AS property_value
        FROM sys.extended_properties AS ep
        LEFT JOIN sys.columns AS c ON c.object_id=ep.major_id AND c.column_id=ep.minor_id
        WHERE ep.class=1 AND ep.major_id=OBJECT_ID(?)
        ORDER BY ep.minor_id, ep.name
        """,
        """
        WITH target AS (SELECT OBJECT_ID(?) AS object_id)
        SELECT fk.name AS foreign_key_name,
               CASE WHEN fk.parent_object_id=target.object_id THEN 'OUTGOING' ELSE 'INCOMING' END AS direction,
               ps.name AS parent_schema, pt.name AS parent_table, pc.name AS parent_column,
               rs.name AS referenced_schema, rt.name AS referenced_table, rc.name AS referenced_column,
               fkc.constraint_column_id, fk.is_disabled, fk.is_not_trusted
        FROM sys.foreign_keys AS fk
        JOIN sys.foreign_key_columns AS fkc ON fkc.constraint_object_id=fk.object_id
        JOIN sys.tables AS pt ON pt.object_id=fk.parent_object_id
        JOIN sys.schemas AS ps ON ps.schema_id=pt.schema_id
        JOIN sys.columns AS pc ON pc.object_id=pt.object_id AND pc.column_id=fkc.parent_column_id
        JOIN sys.tables AS rt ON rt.object_id=fk.referenced_object_id
        JOIN sys.schemas AS rs ON rs.schema_id=rt.schema_id
        JOIN sys.columns AS rc ON rc.object_id=rt.object_id AND rc.column_id=fkc.referenced_column_id
        CROSS JOIN target
        WHERE fk.parent_object_id=target.object_id OR fk.referenced_object_id=target.object_id
        ORDER BY fk.name, fkc.constraint_column_id
        """
    };

    private static final String[] LOOKUP_NAMES = {"lookup_candidates"};
    private static final String[] LOOKUP_SQL = {
        """
        SELECT TOP (301) s.name AS schema_name, t.name AS table_name,
               c.column_id, c.name AS column_name, ty.name AS type_name, c.is_nullable
        FROM sys.tables AS t
        JOIN sys.schemas AS s ON s.schema_id=t.schema_id
        JOIN sys.columns AS c ON c.object_id=t.object_id
        JOIN sys.types AS ty ON ty.user_type_id=c.user_type_id
        WHERE t.is_ms_shipped=0 AND t.object_id<>OBJECT_ID(?)
          AND (LOWER(t.name) LIKE N'%status%'
            OR LOWER(t.name) LIKE N'%deploy%type%'
            OR LOWER(t.name) LIKE N'%get%type%'
            OR LOWER(t.name) LIKE N'%priority%'
            OR ((LOWER(t.name) LIKE N'%projectplanning%' OR LOWER(t.name) LIKE N'%lookup%')
                AND LOWER(c.name) IN (N'status',N'deploytype',N'gettype',N'priority')))
        ORDER BY s.name, t.name, c.column_id
        """
    };

    private static final String[] MODULE_NAMES = {"module_visibility", "declared_references", "text_reference_candidates"};
    private static final String[] MODULE_SQL = {
        """
        SELECT HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'VIEW DEFINITION') AS database_view_definition,
               HAS_PERMS_BY_NAME(?, N'OBJECT', N'VIEW DEFINITION') AS target_view_definition
        """,
        """
        SELECT DISTINCT TOP (301) s.name AS schema_name, o.name AS object_name,
               o.type_desc, d.is_schema_bound_reference
        FROM sys.sql_expression_dependencies AS d
        JOIN sys.objects AS o ON o.object_id=d.referencing_id
        JOIN sys.schemas AS s ON s.schema_id=o.schema_id
        WHERE d.referenced_id=OBJECT_ID(?) AND o.is_ms_shipped=0
          AND o.type IN ('P','PC','V','FN','IF','TF','FS','FT')
        ORDER BY s.name, o.name
        """,
        """
        WITH target AS (SELECT OBJECT_ID(?) AS object_id)
        SELECT TOP (301) s.name AS schema_name, o.name AS object_name, o.type_desc
        FROM sys.sql_modules AS m
        JOIN sys.objects AS o ON o.object_id=m.object_id
        JOIN sys.schemas AS s ON s.schema_id=o.schema_id
        CROSS JOIN target
        WHERE target.object_id IS NOT NULL AND o.is_ms_shipped=0
          AND o.type IN ('P','V','FN','IF','TF')
          AND CHARINDEX(N'Internal_ProjectPlanning', m.definition)>0
        ORDER BY s.name, o.name
        """
    };

    private static String csv(String value) {
        return value == null ? "\\N" : "\"" + value.replace("\"", "\"\"") + "\"";
    }

    private static void readMetadata(Connection connection, String[] names, String[] queries) throws SQLException {
        // Fixed metadata SELECTs only. Never read the full discovery.sql file:
        // its later row queries have a separate approval/timezone gate.
        for (int index = 0; index < queries.length; index++) {
            System.out.println("METADATA_BEGIN " + names[index]);
            try (PreparedStatement statement = connection.prepareStatement(queries[index])) {
                statement.setNString(1, "dbo.Internal_ProjectPlanning");
                statement.setQueryTimeout(10);
                statement.setMaxRows(5001);
                try (ResultSet rows = statement.executeQuery()) {
                    int columns = rows.getMetaData().getColumnCount();
                    for (int column = 1; column <= columns; column++) {
                        if (column > 1) System.out.print(",");
                        System.out.print(csv(rows.getMetaData().getColumnLabel(column)));
                    }
                    System.out.println();
                    int count = 0;
                    while (rows.next()) {
                        if (++count > 5000) throw new SQLException("Metadata limit reached");
                        for (int column = 1; column <= columns; column++) {
                            if (column > 1) System.out.print(",");
                            String value = rows.getString(column);
                            if ("property_value".equals(rows.getMetaData().getColumnLabel(column)) && value != null &&
                                java.util.regex.Pattern.compile("(?i)(password|passwd|secret|access.?token|authorization|bearer)\\s*[:= ]|https?://[^/\\s]+@|eyJ[A-Za-z0-9_-]+\\.").matcher(value).find()) {
                                value = "[REDACTED: potentially sensitive metadata]";
                            }
                            System.out.print(csv(value));
                        }
                        System.out.println();
                    }
                    System.out.println("METADATA_ROW_COUNT=" + count);
                    if ((names[index].equals("lookup_candidates") || names[index].equals("declared_references") ||
                         names[index].equals("text_reference_candidates")) && count == 301) {
                        System.out.println("Candidate search may be truncated at 301 metadata rows; no automatic scope expansion.");
                    }
                    if (count == 0) System.out.println("No visible metadata. Do not infer object/columns are absent.");
                }
            }
            System.out.println("METADATA_END " + names[index]);
        }
    }

    private static Connection connectInteractive(String server, String database, int port) throws SQLException {
        SQLServerDataSource source = new SQLServerDataSource();
        source.setServerName(server);
        source.setPortNumber(port);
        source.setDatabaseName(database);
        source.setEncrypt("true");
        source.setTrustServerCertificate(false);
        source.setApplicationIntent("ReadOnly");
        source.setApplicationName("DeploymentMonitoringUatPermissionProbe");
        source.setLoginTimeout(300);
        source.setQueryTimeout(10);
        source.setCancelQueryTimeout(5);
        source.setConnectRetryCount(0);
        AtomicBoolean attempted = new AtomicBoolean();
        // Same public client ID as Microsoft JDBC 13.4; same interactive flow.
        // Use the supported callback to avoid its built-in 20-second wait.
        source.setAccessTokenCallback((spn, stsurl) -> {
            if (!attempted.compareAndSet(false, true)) throw new IllegalStateException("Repeat authentication disabled");
            ExecutorService executor = Executors.newSingleThreadExecutor();
            CompletableFuture<IAuthenticationResult> pending = null;
            try {
                URI authority = URI.create(stsurl);
                if (!"https".equals(authority.getScheme()) || authority.getUserInfo() != null ||
                    !("login.windows.net".equalsIgnoreCase(authority.getHost()) ||
                      "login.microsoftonline.com".equalsIgnoreCase(authority.getHost())) ||
                    !("https://database.windows.net/".equals(spn) || "https://database.windows.net".equals(spn))) {
                    throw new IllegalArgumentException("Unexpected authentication authority or scope");
                }
                PublicClientApplication app = PublicClientApplication
                    .builder("7f98cb04-cd1e-40df-9140-3bf7e2cea4db")
                    .executorService(executor).authority(stsurl).build();
                String scope = spn.endsWith("/") ? spn + ".default" : spn + "/.default";
                InteractiveRequestParameters request = InteractiveRequestParameters
                    .builder(URI.create("http://localhost")).scopes(Set.of(scope)).build();
                System.out.println("ENTRA_INTERACTIVE_STARTED: complete sign-in/MFA in the browser within 240 seconds.");
                pending = app.acquireToken(request);
                IAuthenticationResult result = pending.get(240, TimeUnit.SECONDS);
                System.out.println("ENTRA_INTERACTIVE_COMPLETE: credential remains in memory only.");
                // Pass the credential straight to JDBC; never print/save/inspect it.
                return new SqlAuthenticationToken(result.accessToken(), result.expiresOnDate());
            } catch (Exception failure) {
                if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
                diagnostic("ENTRA_INTERACTIVE_CALLBACK", failure);
                throw new IllegalStateException("Interactive authentication failed");
            } finally {
                if (pending != null && !pending.isDone()) pending.cancel(true);
                executor.shutdownNow();
            }
        });
        return source.getConnection();
    }

    private static int publicHttpsCheck() {
        Logger.getLogger("").setLevel(Level.OFF);
        boolean passed = true;
        for (String host : new String[] {"login.microsoftonline.com", "login.windows.net"}) {
            HttpsURLConnection connection = null;
            try {
                connection = (HttpsURLConnection) URI.create("https://" + host +
                    "/common/v2.0/.well-known/openid-configuration").toURL().openConnection();
                connection.setConnectTimeout(8000);
                connection.setReadTimeout(8000);
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                int status = connection.getResponseCode();
                System.out.println("Public HTTPS " + host + ": HTTP " + status);
                if (status < 200 || status >= 400) passed = false;
            } catch (Exception failure) {
                passed = false;
                System.err.println("Public HTTPS " + host + ": failed");
                diagnostic("PUBLIC_HTTPS", failure);
            } finally { if (connection != null) connection.disconnect(); }
        }
        return passed ? 0 : 3;
    }

    private static String messageHints(Throwable failure) {
        Set<String> hints = new LinkedHashSet<>();
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        Throwable current = failure;
        for (int depth = 0; current != null && depth < 6 && seen.add(current); depth++) {
            String message = current.getMessage();
            if (message != null) {
                // Inspect only in memory; no raw message or substring is emitted.
                String text = message.substring(0, Math.min(message.length(), 10000)).toLowerCase(Locale.ROOT);
                if (text.contains("certificate") || text.contains("pkix") || text.contains("hostnameincertificate")) hints.add("CERTIFICATE_HINT");
                if (text.contains("tls") || text.contains("ssl") || text.contains("handshake")) hints.add("TLS_HINT");
                if (text.contains("failed to load") || text.contains("unable to load") ||
                    text.contains("classnotfound") || text.contains("noclassdeffound") ||
                    text.contains("nosuchmethod") || text.contains("missing dependency")) hints.add("DEPENDENCY_HINT");
                if (text.contains("browser") || text.contains("desktop") || text.contains("headless")) hints.add("BROWSER_HINT");
                if (text.contains("tcp/ip") || text.contains("network") || text.contains("socket") ||
                    text.contains("timed out") || text.contains("timeout") || text.contains("connection refused") ||
                    text.contains("unknownhost")) hints.add("NETWORK_HINT");
                if (text.contains("authentication") || text.contains("aadsts") || text.contains("msal") ||
                    text.contains("login failed")) hints.add("AUTHENTICATION_HINT");
            }
            current = current.getCause();
        }
        return hints.isEmpty() ? "UNCLASSIFIED" : String.join("|", hints);
    }

    private static int offlineSelfTest() {
        String[][] cases = {
            {"PKIX certificate validation failed", "CERTIFICATE_HINT"},
            {"SSL handshake failed", "TLS_HINT"},
            {"Failed to load required library", "DEPENDENCY_HINT"},
            {"Cannot open browser in headless mode", "BROWSER_HINT"},
            {"TCP/IP connection timed out", "NETWORK_HINT"},
            {"AADSTS authentication failed", "AUTHENTICATION_HINT"},
            {"opaque failure password=synthetic-secret", "UNCLASSIFIED"}
        };
        for (String[] item : cases) {
            if (!messageHints(new RuntimeException(item[0])).equals(item[1])) {
                System.err.println("OFFLINE SELF-TEST FAILED (classification). No connection attempted.");
                return 5;
            }
        }
        ByteArrayOutputStream captured = new ByteArrayOutputStream();
        PrintStream previousError = System.err;
        try (PrintStream capture = new PrintStream(captured, true, StandardCharsets.UTF_8)) {
            System.setErr(capture);
            SQLException synthetic = new SQLException("opaque password=synthetic-secret private-host", "bad\nstate", 42);
            synthetic.initCause(new RuntimeException("certificate validation failed token=synthetic-token"));
            diagnostic("OFFLINE_TEST", synthetic);
        } finally {
            System.setErr(previousError);
        }
        String output = captured.toString(StandardCharsets.UTF_8);
        if (!output.contains("diagnostic.messageHints=CERTIFICATE_HINT") ||
            !output.contains("diagnostic.sqlState=unavailable") ||
            !output.contains("diagnostic.vendorCode=42") ||
            output.contains("synthetic") || output.contains("private-host") ||
            output.contains("password=") || output.contains("token=")) {
            System.err.println("OFFLINE SELF-TEST FAILED (redaction). No connection attempted.");
            return 5;
        }
        System.out.println("OFFLINE SELF-TEST: 8 cases passed; no driver load, login, connection or SQL execution.");
        return 0;
    }

    private static final Set<String> SAFE_EXCEPTION_TYPES = Set.of(
        "java.sql.SQLException", "java.sql.SQLTimeoutException",
        "java.sql.SQLNonTransientConnectionException", "java.sql.SQLTransientConnectionException",
        "com.microsoft.sqlserver.jdbc.SQLServerException",
        "javax.net.ssl.SSLException", "javax.net.ssl.SSLHandshakeException",
        "javax.net.ssl.SSLPeerUnverifiedException", "java.security.cert.CertificateException",
        "java.security.cert.CertificateExpiredException", "java.security.cert.CertificateNotYetValidException",
        "sun.security.validator.ValidatorException", "sun.security.provider.certpath.SunCertPathBuilderException",
        "java.net.UnknownHostException", "java.net.ConnectException",
        "java.net.SocketException", "java.net.SocketTimeoutException", "java.io.IOException",
        "java.util.concurrent.ExecutionException", "java.util.concurrent.CompletionException",
        "java.util.concurrent.TimeoutException", "java.util.concurrent.CancellationException",
        "java.awt.HeadlessException", "java.lang.UnsupportedOperationException",
        "java.lang.SecurityException", "java.lang.IllegalArgumentException", "java.lang.IllegalStateException",
        "java.lang.ClassNotFoundException", "java.lang.NoClassDefFoundError",
        "java.lang.NoSuchMethodError", "java.lang.ExceptionInInitializerError",
        "com.microsoft.aad.msal4j.MsalException", "com.microsoft.aad.msal4j.MsalClientException",
        "com.microsoft.aad.msal4j.MsalServiceException", "com.microsoft.aad.msal4j.MsalInteractionRequiredException"
    );

    private static void diagnostic(String stage, Throwable failure) {
        // SQLState is printed only in its fixed five-character format. Never
        // print messages, cause messages, stack traces or arbitrary class names.
        SQLException error = failure instanceof SQLException ? (SQLException) failure : null;
        String state = error == null ? null : error.getSQLState();
        String safeState = state != null && state.matches("[A-Z0-9]{5}") ? state : "unavailable";
        System.err.println("diagnostic.stage=" + stage);
        System.err.println("diagnostic.sqlState=" + safeState);
        System.err.println("diagnostic.vendorCode=" + (error == null ? "unavailable" : Integer.toString(error.getErrorCode())));
        System.err.println("diagnostic.messageHints=" + messageHints(failure));
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        Throwable current = failure;
        for (int depth = 0; current != null && depth < 6 && seen.add(current); depth++) {
            String type = current.getClass().getName();
            System.err.println("diagnostic.causeType[" + depth + "]=" +
                (SAFE_EXCEPTION_TYPES.contains(type) ? type : "unlisted"));
            current = current.getCause();
        }
    }

    private static final String PERMISSION_SQL = """
        SELECT
          CASE WHEN DB_NAME() = ? THEN 1 ELSE 0 END AS expected_database,
          HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'SELECT') AS can_select,
          HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'INSERT') AS can_insert,
          HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'UPDATE') AS can_update,
          HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'DELETE') AS can_delete,
          HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'ALTER') AS can_alter,
          HAS_PERMS_BY_NAME(N'dbo.Internal_ProjectPlanning', N'OBJECT', N'CONTROL') AS can_control_object,
          HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CONTROL') AS can_control_database,
          IS_ROLEMEMBER(N'db_owner') AS is_db_owner,
          IS_ROLEMEMBER(N'db_datawriter') AS is_db_datawriter,
          IS_SRVROLEMEMBER(N'sysadmin') AS is_sysadmin
        """;

    public static void main(String[] args) {
        int exit = run(args);
        if (exit != 0) System.exit(exit);
    }

    private static int run(String[] args) {
        if (args.length == 1 && args[0].equals("--browser-check")) {
            boolean desktop = java.awt.Desktop.isDesktopSupported();
            System.out.println("Java headless=" + java.awt.GraphicsEnvironment.isHeadless());
            System.out.println("Java Desktop supported=" + desktop);
            System.out.println("Java browser action supported=" +
                (desktop && java.awt.Desktop.getDesktop().isSupported(java.awt.Desktop.Action.BROWSE)));
            return 0;
        }
        if (args.length == 1 && args[0].equals("--self-test")) return offlineSelfTest();
        if (args.length == 1 && args[0].equals("--public-https-check")) return publicHttpsCheck();
        if (args.length < 3 || args.length > 8) {
            System.err.println("Usage: UatReadOnlyProbe.java <server> <database> <port> [--connect-approved] [--metadata-approved | --semantics-approved | --lookup-metadata-approved | --module-metadata-approved]");
            return 2;
        }
        boolean connectApproved = false;
        boolean metadataApproved = false;
        boolean semanticsApproved = false;
        boolean lookupApproved = false;
        boolean modulesApproved = false;
        for (int option = 3; option < args.length; option++) {
            if (args[option].equals("--connect-approved") && !connectApproved) connectApproved = true;
            else if (args[option].equals("--metadata-approved") && !metadataApproved) metadataApproved = true;
            else if (args[option].equals("--semantics-approved") && !semanticsApproved) semanticsApproved = true;
            else if (args[option].equals("--lookup-metadata-approved") && !lookupApproved) lookupApproved = true;
            else if (args[option].equals("--module-metadata-approved") && !modulesApproved) modulesApproved = true;
            else { System.err.println("Unknown or duplicate option. No connection attempted."); return 2; }
        }
        if ((metadataApproved ? 1 : 0) + (semanticsApproved ? 1 : 0) + (lookupApproved ? 1 : 0) + (modulesApproved ? 1 : 0) > 1) {
            System.err.println("Choose one discovery scope. No connection attempted."); return 2;
        }
        String server = args[0];
        String database = args[1];
        int port;
        try { port = Integer.parseInt(args[2]); }
        catch (NumberFormatException error) { System.err.println("Invalid port"); return 2; }
        if (!server.matches("[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?") ||
                !database.matches("[A-Za-z0-9_-]{1,128}") || port < 1 || port > 65535) {
            System.err.println("Invalid target. No connection attempted.");
            return 2;
        }
        System.out.println("Server: " + server + ":" + port);
        System.out.println("Database: " + database);
        System.out.println("Authentication: Entra interactive callback (user completes MFA; wait up to 240s)");
        System.out.println("TLS: encrypt=true; trustServerCertificate=false");
        System.out.println("Query: one fixed parameterized permission SELECT; no source rows");
        System.out.println("Database parameter: supplied target database name");
        System.out.println(PERMISSION_SQL);
        if (metadataApproved) {
            System.out.println("Metadata mode: three fixed metadata SELECTs after permission checks pass.");
            for (String sql : METADATA_SQL) System.out.println(sql);
        }
        if (semanticsApproved) {
            System.out.println("Semantics metadata mode: extended properties and foreign keys only after permission checks pass.");
            for (String sql : SEMANTICS_SQL) System.out.println(sql);
        }
        if (lookupApproved) {
            System.out.println("Lookup candidate mode: names/types only; no lookup data rows or inferred mappings.");
            for (String sql : LOOKUP_SQL) System.out.println(sql);
        }
        if (modulesApproved) {
            System.out.println("Module reference metadata: names/types/visibility only. No module execution or returned definitions.");
            for (String sql : MODULE_SQL) System.out.println(sql);
        }
        if (!connectApproved) {
            System.out.println("PLAN ONLY. No driver load, login, connection or SQL execution.");
            return 0;
        }

        // Never print exception messages, tokens, principal names or SQL errors.
        Logger.getLogger("").setLevel(Level.OFF);
        String stage = "LOAD_DRIVER";
        try {
            Class.forName("com.microsoft.sqlserver.jdbc.SQLServerDriver");
            // No retry loop, fallback target/authentication, or TLS bypass.
            stage = "CONNECT_AUTH";
            try (Connection connection = connectInteractive(server, database, port)) {
                System.out.println("Connection established. Checking permissions only.");
                stage = "PREPARE_PERMISSION_SELECT";
                try (PreparedStatement statement = connection.prepareStatement(PERMISSION_SQL)) {
                    statement.setString(1, database);
                    statement.setQueryTimeout(10);
                    statement.setMaxRows(1);
                    stage = "EXECUTE_PERMISSION_SELECT";
                    try (ResultSet result = statement.executeQuery()) {
                        stage = "READ_PERMISSION_RESULT";
                        if (!result.next()) {
                            System.err.println("Permission result missing. Stop; DBA confirmation required.");
                            return 4;
                        }
                        boolean expectedDatabase = false;
                        boolean canSelect = false;
                        boolean restricted = true;
                        for (int column = 1; column <= result.getMetaData().getColumnCount(); column++) {
                            int value = result.getInt(column);
                            boolean unknown = result.wasNull();
                            String name = result.getMetaData().getColumnLabel(column);
                            System.out.println(name + "=" + (unknown ? "unknown" : Integer.toString(value)));
                            if (name.equals("expected_database")) expectedDatabase = !unknown && value == 1;
                            else if (name.equals("can_select")) canSelect = !unknown && value == 1;
                            else if (unknown || value != 0) restricted = false;
                        }
                        if (!expectedDatabase || !canSelect || !restricted) {
                            System.out.println("Permission audit: pending DBA review (broad rights, missing SELECT, mismatch or unknown).");
                            System.out.println("No further SQL is executed.");
                            return 4;
                        }
                        System.out.println("Checked flags passed. NOT complete least-privilege proof or G0 approval.");
                        if (!metadataApproved && !semanticsApproved && !lookupApproved && !modulesApproved) System.out.println("Stop. Separate approval is required for metadata discovery.");
                        stage = "CLOSE_RESOURCES";
                    }
                }
                if (metadataApproved) {
                    stage = "READ_METADATA";
                    readMetadata(connection, METADATA_NAMES, METADATA_SQL);
                    System.out.println("Metadata discovery complete. No source-table rows read.");
                    stage = "CLOSE_RESOURCES";
                }
                if (semanticsApproved) {
                    stage = "READ_SEMANTICS_METADATA";
                    readMetadata(connection, SEMANTICS_NAMES, SEMANTICS_SQL);
                    System.out.println("Extended-property/FK metadata discovery complete. No source-table rows read.");
                    stage = "CLOSE_RESOURCES";
                }
                if (lookupApproved) {
                    stage = "READ_LOOKUP_CANDIDATE_METADATA";
                    readMetadata(connection, LOOKUP_NAMES, LOOKUP_SQL);
                    System.out.println("Candidate metadata complete. No table data rows read; no code meanings inferred.");
                    stage = "CLOSE_RESOURCES";
                }
                if (modulesApproved) {
                    stage = "READ_MODULE_REFERENCE_METADATA";
                    readMetadata(connection, MODULE_NAMES, MODULE_SQL);
                    System.out.println("Module reference metadata complete. No module executed, definitions returned or data rows read.");
                    stage = "CLOSE_RESOURCES";
                }
            }
            return 0;
        } catch (ClassNotFoundException | LinkageError error) {
            diagnostic(stage, error);
            System.err.println("JDBC/auth dependency unavailable. No fallback/download attempted.");
            return 3;
        } catch (SQLException error) {
            diagnostic(stage, error);
            System.err.println("Connection/auth/permission query failed. Details suppressed; stop for review.");
            return 3;
        } catch (RuntimeException error) {
            diagnostic(stage, error);
            System.err.println("Probe failed. Details suppressed; no retry attempted.");
            return 3;
        }
    }
}
