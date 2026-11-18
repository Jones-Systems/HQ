/**
 * Live Social source (task.social-live-adapter.001): the SocialWorkspacePort over the desktop service
 * bridge's closed Social transport. The renderer holds no endpoint, header, token or HTTP capability.
 */
export { createLiveSocialPort, httpError, type LiveSocialPortOptions } from './port';
export { guardBrand, guardDraft, guardRun, guardSample, guardTool, guardWorkspace, errorText, type GuardedWorkspace } from './guards';
export {
  SOCIAL_SERVICE_ROUTES, isSocialServiceTransport, socialServiceBridge,
  type ServiceResponse, type SocialServiceParams, type SocialServiceRoute, type SocialServiceTransport,
} from './transport';
