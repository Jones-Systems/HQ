'use strict';

const fs = require('node:fs');
const path = require('node:path');

const METADATA_ALLOWANCE_BYTES = 1024 ** 3;
const RESERVE_BYTES = 2 * 1024 ** 3;

function admitNativeStorage({ sourceBundle, outputDirectory, bundleCopies, fs: io = fs }) {
  if (!Number.isSafeInteger(bundleCopies) || bundleCopies <= 0) throw new Error('Native storage copy count is unknown or malformed');
  const nonnegative = value => typeof value === 'bigint' && value >= 0n;
  const measure = filename => {
    const stat = io.lstatSync(filename, { bigint: true });
    if (!nonnegative(stat.size) || !nonnegative(stat.blocks)) throw new Error('Native bundle byte count is unknown or malformed');
    const allocated = stat.blocks * 512n;
    let bytes = stat.size > allocated ? stat.size : allocated;
    if (stat.isDirectory()) for (const name of io.readdirSync(filename)) bytes += measure(path.join(filename, name));
    else if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error('Native bundle contains an unsupported filesystem entry');
    return bytes;
  };
  if (!io.lstatSync(sourceBundle, { bigint: true }).isDirectory()) throw new Error('Native storage source must be a bundle directory');
  const bundleBytes = measure(sourceBundle);
  if (bundleBytes <= 0n) throw new Error('Native bundle byte count is unknown or malformed');
  const filesystem = io.statfsSync(outputDirectory, { bigint: true });
  if (!filesystem || !nonnegative(filesystem.bsize) || filesystem.bsize === 0n || !nonnegative(filesystem.bavail) || !nonnegative(filesystem.bfree) || !nonnegative(filesystem.blocks) || filesystem.bavail > filesystem.bfree || filesystem.bfree > filesystem.blocks) throw new Error('Native storage availability is unknown or malformed');
  const availableBytes = filesystem.bsize * filesystem.bavail;
  const additionalPeakBytes = BigInt(bundleCopies) * bundleBytes + BigInt(METADATA_ALLOWANCE_BYTES);
  const requiredAvailableBytes = additionalPeakBytes + BigInt(RESERVE_BYTES);
  const values = { bundleBytes, availableBytes, additionalPeakBytes, requiredAvailableBytes };
  if (Object.values(values).some(value => value > BigInt(Number.MAX_SAFE_INTEGER))) throw new Error('Native storage measurement exceeds the supported byte range');
  const storage = { ...Object.fromEntries(Object.entries(values).map(([key, value]) => [key, Number(value)])), bundleCopies, metadataAllowanceBytes: METADATA_ALLOWANCE_BYTES, reserveBytes: RESERVE_BYTES };
  if (availableBytes < requiredAvailableBytes) {
    const error = new Error('Native smoke storage is insufficient; no synthetic bundle copies were admitted');
    error.storage = storage;
    throw error;
  }
  return storage;
}

module.exports = { admitNativeStorage, METADATA_ALLOWANCE_BYTES, RESERVE_BYTES };
