/**
 * Style rules from the document's stylesheets, for what jsdom cannot compute
 * (pseudo-elements, media queries, colours it does not parse). It reads the
 * rules emotion injected, so a test using it pins a mechanism: label it as a guard.
 */

/** Every style rule (media rules included) whose selector is `<something matching element><suffix>`. */
export function rulesFor(element: Element, suffix: string): CSSStyleRule[] {
  const found: CSSStyleRule[] = [];
  const visit = (rules: CSSRuleList) => {
    for (const rule of Array.from(rules)) {
      if ('selectorText' in rule) {
        const style = rule as CSSStyleRule;
        for (const selector of style.selectorText.split(',').map((part) => part.trim())) {
          if (selector.endsWith(suffix)) {
            try {
              if (element.matches(selector.slice(0, selector.length - suffix.length))) {
                found.push(style);
              }
            } catch {
              // a selector jsdom cannot parse is not ours to check
            }
          }
        }
      } else if ('cssRules' in rule) {
        visit((rule as CSSGroupingRule).cssRules);
      }
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    visit(sheet.cssRules);
  }
  return found;
}
