import { roles } from './catalog.mjs';
import { translations } from './i18n.mjs';
import { shareProfile } from './profile.mjs';
import { makePlan, pngBlob } from './renderer.mjs';

export const sharingText = translations;

export async function downloadIdentity({ user, result, language, snapshot }) {
  const profile = shareProfile(user, result, language, snapshot);
  if (!profile) throw new Error(translations(language).empty);
  const role = roles.find(role => role.key === profile.roleKey);
  if (!role) throw new Error('Unknown automatically assigned identity');
  const plan = await makePlan(profile, role);
  const blob = await pngBlob(plan);
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url;
  link.download = `TokenFlow-${profile.roleKey}-${language}.png`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
