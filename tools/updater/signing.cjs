'use strict';

const TEAM_ID = '2CUPSQS986';
const PRODUCT_ID = 'org.jones-systems.hq.local';
const DEVELOPER_ID = Object.freeze({ schemaVersion: 1, mode: 'developer-id', teamId: TEAM_ID, identifier: PRODUCT_ID, hardenedRuntime: true, secureTimestamp: true, notarized: true, stapled: true });

function validateSigning(value, bundleId) {
  if (!value || Object.keys(value).sort().join(',') !== Object.keys(DEVELOPER_ID).sort().join(',') || bundleId !== PRODUCT_ID || Object.keys(DEVELOPER_ID).some(key => value[key] !== DEVELOPER_ID[key])) throw new Error('Invalid Developer ID signing policy');
  return value;
}
function requirement(identifier = PRODUCT_ID) {
  if (!/^[A-Za-z0-9.-]+$/.test(identifier)) throw new Error('Invalid code identifier');
  return `identifier "${identifier}" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${TEAM_ID}"`;
}
function verifySignatureDetails(details, identifier, production) {
  const field = name => details.split(/\r?\n/).find(line => line.startsWith(`${name}=`))?.slice(name.length + 1);
  if (field('Identifier') !== identifier) throw new Error('Code signature identity differs');
  if (!production) {
    if (field('Signature') !== 'adhoc') throw new Error('Expected explicit ad-hoc development signature');
    return;
  }
  if (field('Signature') === 'adhoc' || field('TeamIdentifier') !== TEAM_ID || !/^Developer ID Application: .+ \(2CUPSQS986\)$/.test(field('Authority') ?? '') || !field('Timestamp') || !/flags=0x[0-9a-f]+\(runtime\)/i.test(details)) throw new Error('Developer ID team, timestamp or hardened runtime differs');
}
function verifyDesignatedRequirement(value, identifier) {
  if (/\bcdhash\b|\bor\b/.test(value) || !value.includes(`identifier "${identifier}"`) || !value.includes('anchor apple generic') || !value.includes('certificate leaf[subject.OU] = "2CUPSQS986"') || !value.includes('certificate leaf[field.1.2.840.113635.100.6.1.13]')) throw new Error('Unstable or unexpected designated requirement');
}
module.exports = { TEAM_ID, PRODUCT_ID, DEVELOPER_ID, validateSigning, requirement, verifySignatureDetails, verifyDesignatedRequirement };
