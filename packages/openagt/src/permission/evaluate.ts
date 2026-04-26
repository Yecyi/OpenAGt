import { Wildcard } from "@/util"

type Rule = {
  permission: string
  pattern: string
  action: "allow" | "deny" | "ask"
}

export function evaluate(permission: string, pattern: string, ...rulesets: Rule[][]): Rule {
  const rules = rulesets.flat()
  const specificity = (value: string) => (value === "*" ? 0 : value.replaceAll("*", "").length)
  const score = (rule: Rule) => specificity(rule.permission) + specificity(rule.pattern)
  const match = rules.reduce<Rule | undefined>((best, rule) => {
    if (!Wildcard.match(permission, rule.permission) || !Wildcard.match(pattern, rule.pattern)) return best
    if (!best) return rule
    if (rule.action === "deny") return rule
    if (best.action === "deny") return score(rule) > score(best) ? rule : best
    return score(rule) >= score(best) ? rule : best
  }, undefined)
  return match ?? { action: "ask", permission, pattern: "*" }
}
