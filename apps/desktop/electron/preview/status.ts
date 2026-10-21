// Mac acceptance and the two unmeasured callbacks: spec.hq-integration-parallel-execution#ac.preview-enablement.001.
export function previewPlatformQualified(platform: NodeJS.Platform): boolean {
  return platform === 'darwin';
}
export const PREVIEW_HOST_ENABLED = previewPlatformQualified(process.platform);
export const PREVIEW_PICK_QUALIFIED = PREVIEW_HOST_ENABLED;
