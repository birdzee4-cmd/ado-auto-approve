const fs = require('fs');
const path = require('path');
const [source, output, version] = process.argv.slice(2);
if (!source || !output || !/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Usage: node scripts/build-operations-hub-alert-lifecycle-first-seen.js <source> <output> <next-version>');
if (!fs.existsSync(source) || fs.existsSync(output)) throw new Error('Source must exist and output must not exist');
fs.cpSync(source, output, { recursive: true });
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const write = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const root = path.join(output, 'Microsoft.Flow', 'flows');
const assetId = read(path.join(root, 'manifest.json')).flowAssets.assetPaths[0];
const definitionPath = path.join(root, assetId, 'definition.json');
const wrapper = read(definitionPath);
const manifestPath = path.join(output, 'manifest.json');
const manifest = read(manifestPath);
const flow = wrapper.properties.definition;
const loop = flow.actions.For_Each_RESOLVED_Email.actions;
const eligible = loop.Condition_Is_Eligible_RESOLVED.actions;
const pending = eligible.Condition_Message_Not_Processed;
const match = pending.actions.Get_Matching_Open_FIRING;
const exact = pending.actions.Condition_Exactly_One_Match;
if (!match || !exact.actions.Update_Matching_Incident_RESOLVED) throw new Error('Unexpected source flow');

// Prefer the full email: Outlook bodyPreview can truncate First Seen.
let body = "coalesce(items('For_Each_RESOLVED_Email')?['body'],items('For_Each_RESOLVED_Email')?['bodyPreview'],'')";
for (const tag of ['<br>', '<br/>', '<br />', '</p>', '</div>']) body = `replace(${body},'${tag}','\n')`;
for (const tag of ['<b>', '</b>', '<strong>', '</strong>']) body = `replace(${body},'${tag}','')`;
loop.Compose_Email_Body.inputs = '@' + body;
const raw = label => `@if(contains(outputs('Compose_Email_Body'),'${label}:'),trim(first(split(last(split(outputs('Compose_Email_Body'),'${label}:')),'\n'))),'')`;
const parsed = name => `@if(greaterOrEquals(length(outputs('${name}')),16),concat(substring(outputs('${name}'),6,4),'-',substring(outputs('${name}'),3,2),'-',substring(outputs('${name}'),0,2),'T',substring(outputs('${name}'),11,5),':00+07:00'),'1900-01-01T00:00:00Z')`;
eligible.Compose_First_Seen_Raw = { type: 'Compose', inputs: raw('First Seen'), runAfter: { Compose_Resource: ['Succeeded'] } };
eligible.Compose_First_Seen = { type: 'Compose', inputs: parsed('Compose_First_Seen_Raw'), runAfter: { Compose_First_Seen_Raw: ['Succeeded'] } };
eligible.Compose_Incident_Id = {
  type: 'Compose',
  // Use precisely the same deterministic key expression as Incident Automation.
  inputs: "@toLower(concat('INC-',formatDateTime(outputs('Compose_First_Seen'),'yyyyMMddHHmmss'),'-',replace(replace(outputs('Compose_Resource'),' ','-'),'/','-'),'-',replace(replace(outputs('Compose_Alert_Name'),' ','-'),'/','-')))",
  runAfter: { Compose_First_Seen: ['Succeeded'] }
};
eligible.Compose_Resolved_At_Raw.inputs = raw('Resolved At');
eligible.Compose_Resolved_At_Raw.runAfter = { Compose_Incident_Id: ['Succeeded'] };
eligible.Compose_Resolved_At.inputs = parsed('Compose_Resolved_At_Raw');
pending.expression.and.push(
  { greaterOrEquals: ["@length(outputs('Compose_First_Seen_Raw'))", 16] },
  { greaterOrEquals: ["@length(outputs('Compose_Resolved_At_Raw'))", 16] },
  { greater: ["@ticks(outputs('Compose_Resolved_At'))", "@ticks(outputs('Compose_First_Seen'))"] }
);
match.inputs.parameters['$filter'] = "@concat('IncidentId eq ''',replace(outputs('Compose_Incident_Id'),'''',''''''),''' and Title eq ''',replace(outputs('Compose_Alert_Name'),'''',''''''),''' and Resource eq ''',replace(outputs('Compose_Resource'),'''',''''''),''' and AlertStatus eq ''FIRING'' and ResolvedAt eq null')";
match.inputs.parameters['$top'] = 2;
match.inputs.parameters['$orderby'] = 'ID desc';
exact.expression = { and: [{ equals: ["@length(body('Get_Matching_Open_FIRING')?['value'])", 1] }] };
// Display the event's actual First Seen, avoiding the legacy SharePoint offset.
const post = exact.actions.Post_RESOLVED_to_Teams;
if (post) post.inputs.parameters['body/messageBody'] = post.inputs.parameters['body/messageBody'].replace(/first\(body\('Get_Matching_Open_FIRING'\)\?\['value'\]\)\?\['FirstSeenAt'\]/g, "outputs('Compose_First_Seen')");
flow.contentVersion = version + '.0';
flow.metadata = { ...flow.metadata, clientLastModifiedTime: new Date().toISOString() };
wrapper.properties.displayName = `Operations Hub - Alert Lifecycle Reconciliation v${version} First Seen Guard`;
manifest.details.displayName = `OperationsHub-AlertLifecycleReconciliationv${version}-FirstSeenGuard`;
manifest.details.description = 'Match RESOLVED by deterministic IncidentId including email First Seen; reject missing, reversed, or ambiguous episodes. Never choose the newest unrelated FIRING.';
manifest.details.createdTime = new Date().toISOString();
manifest.resources[assetId].details.displayName = wrapper.properties.displayName;
write(definitionPath, wrapper);
write(manifestPath, manifest);
