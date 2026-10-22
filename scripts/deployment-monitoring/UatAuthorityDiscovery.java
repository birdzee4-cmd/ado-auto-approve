// TLS-protected authentication metadata only. No token request or SQL statement.
// Default is plan-only. Separate user approval required for each handshake.
import com.microsoft.sqlserver.jdbc.SQLServerDataSource;
import java.net.URI;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Locale;
import java.util.concurrent.atomic.AtomicReference;
import java.util.logging.Level;
import java.util.logging.Logger;

class UatAuthorityDiscovery {
    static String tenant(String spn, String stsurl) {
        if (!("https://database.windows.net".equals(spn) || "https://database.windows.net/".equals(spn))) {
            throw new IllegalArgumentException("Unexpected scope");
        }
        URI authority = URI.create(stsurl);
        if (!"https".equalsIgnoreCase(authority.getScheme()) || authority.getUserInfo() != null ||
            authority.getQuery() != null || authority.getFragment() != null ||
            (authority.getPort() != -1 && authority.getPort() != 443) ||
            !("login.windows.net".equalsIgnoreCase(authority.getHost()) ||
              "login.microsoftonline.com".equalsIgnoreCase(authority.getHost()))) {
            throw new IllegalArgumentException("Unexpected authority");
        }
        String path = authority.getPath();
        if (path == null || !path.matches("/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/?")) {
            throw new IllegalArgumentException("Explicit tenant UUID required");
        }
        return path.replace("/", "").toLowerCase(Locale.ROOT);
    }

    static void selfTest() {
        String id = "00000000-0000-0000-0000-000000000001";
        if (!id.equals(tenant("https://database.windows.net/", "https://login.windows.net/" + id + "/"))) throw new AssertionError();
        if (!id.equals(tenant("https://database.windows.net", "https://login.microsoftonline.com/" + id))) throw new AssertionError();
        String[] rejected = { "http://login.windows.net/" + id, "https://example.invalid/" + id,
            "https://login.windows.net/common", "https://user@login.windows.net/" + id,
            "https://login.windows.net/" + id + "?secret=x", "https://login.windows.net:444/" + id };
        for (String authority : rejected) {
            boolean failed = false;
            try { tenant("https://database.windows.net", authority); } catch (IllegalArgumentException expected) { failed = true; }
            if (!failed) throw new AssertionError();
        }
        boolean failed = false;
        try { tenant("https://example.invalid", "https://login.windows.net/" + id); } catch (IllegalArgumentException expected) { failed = true; }
        if (!failed) throw new AssertionError();
        System.out.println("{\"selfTests\":9,\"passed\":9,\"connected\":false}");
    }

    public static void main(String[] args) {
        Logger.getLogger("").setLevel(Level.OFF);
        if (args.length == 1 && "--self-test".equals(args[0])) { selfTest(); return; }
        if (args.length == 0) {
            System.out.println("{\"mode\":\"plan-only\",\"connected\":false,\"tokenRequested\":false,\"sqlExecuted\":false}");
            return;
        }
        if (args.length != 3 || !"--handshake-approved".equals(args[0]) ||
            !args[1].matches("[A-Za-z0-9][A-Za-z0-9.-]*") || !args[2].matches("[A-Za-z0-9_-]{1,128}")) {
            System.out.println("{\"code\":\"INVALID_OPTIONS\"}"); System.exit(1); return;
        }
        AtomicReference<String> confirmedTenant = new AtomicReference<>();
        try {
            SQLServerDataSource source = new SQLServerDataSource();
            source.setServerName(args[1]); source.setPortNumber(1433); source.setDatabaseName(args[2]);
            source.setEncrypt("true"); source.setTrustServerCertificate(false);
            source.setApplicationIntent("ReadOnly"); source.setApplicationName("DeploymentMonitoringAuthorityDiscovery");
            source.setLoginTimeout(10); source.setConnectRetryCount(0);
            source.setAccessTokenCallback((spn, stsurl) -> {
                confirmedTenant.compareAndSet(null, tenant(spn, stsurl));
                // Deliberately abort before obtaining/sending any access token.
                throw new IllegalStateException("Authority discovery complete");
            });
            try (Connection ignored = source.getConnection()) { /* no SQL even if unexpected connection succeeds */ }
        } catch (SQLException | RuntimeException expected) { /* no exception text, SQL errors or secrets */ }
        if (confirmedTenant.get() == null) {
            System.out.println("{\"code\":\"AUTHORITY_NOT_CONFIRMED\",\"sqlExecuted\":false}"); System.exit(1); return;
        }
        System.out.println("{\"stage\":\"AUTHORITY_CONFIRMED\",\"tenantId\":\"" + confirmedTenant.get() +
            "\",\"tokenRequested\":false,\"sqlExecuted\":false}");
    }
}
