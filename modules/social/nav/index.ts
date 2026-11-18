/**
 * Social domain (task.social-domain.001): navigation, brand switcher, project check, Overview, Sources
 * (reserved) and Channels, mounting the content and workbench sections on one module-level session.
 */
export { SocialDomain, type SocialDomainProps } from './SocialDomain';
export { NAV_ITEMS, SECTION_LABELS, SOCIAL_SECTIONS, parseSocialDestination, type NavItem, type SocialRoute, type SocialSection } from './routes';
export { SWITCH_PROJECT_REASON, chooseBrand, domainView, projectLink, selectedBrand, type DomainView, type ProjectLink } from './brand';
export { CAPABILITIES, Overview, type OverviewProps } from './Overview';
export { SOURCES_PROPOSED, Sources } from './Sources';
export { ACCOUNT_CHANNELS, Channels, PUBLISHING_NEEDS } from './Channels';
export { EXAMPLE_WORKSPACE_NOTE, setSocialWorkspacePort, socialWorkspacePort } from './workspace';
