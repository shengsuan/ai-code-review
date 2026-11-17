import explainTemplate from "./explain.md";
import protocolTemplate from "./protocol.md";
import reviewTemplate from "./review.md";
import securityTemplate from "./security.md";
import verificationTemplate from "./verification.md";

export function renderPrompt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => String(vars[key] ?? ""));
}

export function withProtocol(template: string, tools: string, vars: Record<string, string | number>): string {
  const protocol = renderPrompt(protocolTemplate, { tools });
  return renderPrompt(template, { ...vars, protocol });
}

export const prompts = {
  review: reviewTemplate,
  security: securityTemplate,
  verification: verificationTemplate,
  explain: explainTemplate,
};
