#!/usr/bin/env node
/**
 * Apply an S3-compatible bucket lifecycle rule for Arena exam recordings.
 *
 * Safe by default in intent: it only upserts one rule (by ID) scoped to the
 * recordings prefix. Existing rules with different IDs are preserved.
 *
 * Required env (same as API object storage):
 *   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
 * Optional:
 *   S3_FORCE_PATH_STYLE=true|false
 *
 * Usage:
 *   node scripts/apply-recording-lifecycle.mjs --dry-run
 *   node scripts/apply-recording-lifecycle.mjs --days 1
 *   node scripts/apply-recording-lifecycle.mjs --days 1 --prefix recordings/ --rule-id arena-recording-retention
 */
import {
  S3Client,
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
} from '@aws-sdk/client-s3';

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  if (!v || v.startsWith('--')) return 'true';
  return v;
}

const dryRun = process.argv.includes('--dry-run');
const days = Number(arg('days', '1'));
const prefix = String(arg('prefix', 'recordings/'));
const ruleId = String(arg('rule-id', 'arena-recording-retention'));
const abortDays = Number(arg('abort-days', '1'));

if (!Number.isInteger(days) || days < 1 || days > 365) {
  console.error(`Invalid --days: ${arg('days')}. Expected integer 1-365.`);
  process.exit(2);
}
if (!Number.isInteger(abortDays) || abortDays < 1 || abortDays > 30) {
  console.error(`Invalid --abort-days: ${arg('abort-days')}. Expected integer 1-30.`);
  process.exit(2);
}
if (!prefix || prefix.includes('..') || prefix.startsWith('/')) {
  console.error(`Invalid --prefix: ${prefix}`);
  process.exit(2);
}
if (!prefix.startsWith('recordings/')) {
  console.error(`Refusing unsafe prefix "${prefix}". Expected prefix starting with "recordings/".`);
  process.exit(2);
}

const endpoint = process.env.S3_ENDPOINT;
const region = process.env.S3_REGION;
const bucket = process.env.S3_BUCKET;
const accessKeyId = process.env.S3_ACCESS_KEY_ID;
const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
const forcePathStyle = process.env.S3_FORCE_PATH_STYLE === 'true';

const missing = ['S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']
  .filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(', ')}`);
  console.error('Load production S3 env before running this script.');
  process.exit(2);
}

const client = new S3Client({
  endpoint,
  region,
  credentials: { accessKeyId, secretAccessKey },
  forcePathStyle,
});

const desiredRule = {
  ID: ruleId,
  Status: 'Enabled',
  Filter: { Prefix: prefix },
  Expiration: { Days: days },
  AbortIncompleteMultipartUpload: { DaysAfterInitiation: abortDays },
};

function summarizeRules(rules = []) {
  return rules.map((r) => ({
    ID: r.ID,
    Status: r.Status,
    Prefix: r.Filter?.Prefix ?? r.Prefix ?? '(all)',
    ExpirationDays: r.Expiration?.Days ?? null,
    ExpirationDate: r.Expiration?.Date ?? null,
    AbortIncompleteMultipartUploadDays: r.AbortIncompleteMultipartUpload?.DaysAfterInitiation ?? null,
  }));
}

let existingRules = [];
try {
  const current = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
  existingRules = current.Rules ?? [];
} catch (error) {
  const name = error?.name ?? '';
  const code = error?.$metadata?.httpStatusCode;
  // NoSuchLifecycleConfiguration is normal for buckets without lifecycle rules.
  if (name === 'NoSuchLifecycleConfiguration' || code === 404) {
    existingRules = [];
  } else {
    console.error('Failed to read existing lifecycle configuration:', error);
    process.exit(1);
  }
}

const kept = existingRules.filter((r) => r.ID !== ruleId);
const replaced = existingRules.find((r) => r.ID === ruleId);
const finalRules = [...kept, desiredRule];

console.log(JSON.stringify({
  bucket,
  endpoint,
  region,
  dryRun,
  prefix,
  days,
  abortIncompleteMultipartUploadDays: abortDays,
  ruleId,
  existingRules: summarizeRules(existingRules),
  replacedRule: replaced ? summarizeRules([replaced])[0] : null,
  finalRules: summarizeRules(finalRules),
  note: 'Lifecycle expiration is processed by object storage around midnight after objects reach the configured age. A 1-day rule typically deletes objects ~24-48h after creation.',
}, null, 2));

if (dryRun) {
  console.log('DRY RUN: no changes applied.');
  process.exit(0);
}

await client.send(new PutBucketLifecycleConfigurationCommand({
  Bucket: bucket,
  LifecycleConfiguration: { Rules: finalRules },
}));

const verify = await client.send(new GetBucketLifecycleConfigurationCommand({ Bucket: bucket }));
console.log('Applied. Verified rules:');
console.log(JSON.stringify(summarizeRules(verify.Rules ?? []), null, 2));
