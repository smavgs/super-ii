import { localizedHref, type SiteLocale } from './i18n';

export type MemberAction = {
  signedIn: boolean;
  label: string;
  href: string;
};

export function isSignedInUser(locals: App.Locals): boolean {
  if (typeof locals.auth !== 'function') return false;
  try {
    const authentication = locals.auth();
    return Boolean(authentication && 'userId' in authentication && authentication.userId);
  } catch {
    return false;
  }
}

export function memberAction(
  locals: App.Locals,
  locale: SiteLocale,
  options: {
    destination: string;
    signedOutLabel: string;
    signedInLabel: string;
  },
): MemberAction {
  const signedIn = isSignedInUser(locals);
  const plainHref = signedIn
    ? options.destination
    : `/sign-up?redirect_url=${encodeURIComponent(options.destination)}`;
  return {
    signedIn,
    label: signedIn ? options.signedInLabel : options.signedOutLabel,
    href: localizedHref(plainHref, locale),
  };
}
