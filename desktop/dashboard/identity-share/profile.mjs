import { translations } from './i18n.mjs';
const toolNames = { codex: 'Codex', claude: 'Claude Code', gemini: 'Gemini CLI', opencode: 'OpenCode', kimi: 'Kimi CLI', qwen: 'Qwen Code', copilot: 'GitHub Copilot', dsh: 'DeepSeek Harness', pi: 'Pi', amp: 'Amp', openclaw: 'OpenClaw' };

export function shareProfile(user, result, language, snapshot = false) {
  if (!result) return null;
  const total = String(result.intensity.totalExact);
  if (!/^\d+$/.test(total)) throw new Error('Missing token total');
  const tools = result.agents.list.filter(tool => tool.tokens > 0).map(tool => toolNames[tool.name] || tool.name);
  const copy = translations(language);
  return Object.freeze({
    username: user?.name || copy.unnamed,
    totalExact: total,
    tokens: new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(BigInt(total)),
    activeDays: String(result.intensity.activeDays) + copy.dayUnit,
    toolCount: String(tools.length) + copy.toolUnit,
    tools: tools.slice(0, 3).join(' · ') + (tools.length > 3 ? ' …' : ''),
    level: 'Lv.0' + (result.intensity.levelIndex + 1),
    levelIndex: result.intensity.levelIndex,
    period: result.from.replaceAll('-', '.') + '—' + result.to.replaceAll('-', '.'),
    roleKey: result.typeKey,
    snapshot,
    language
  });
}
