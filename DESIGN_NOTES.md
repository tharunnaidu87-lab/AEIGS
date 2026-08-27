# AEGIS Field-Grid UI

This interface intentionally avoids the common “AI dashboard” visual pattern (large gradient hero, glassmorphism, neon-purple cards, excessive pill badges and identical rounded panels).

## Visual idea
AEGIS is styled as a **civil emergency operations board**: a mix of an incident ledger, field map and response-control terminal.

- **Angular panels** instead of soft SaaS cards.
- **Signal red** is reserved for operational emphasis and danger, not decoration.
- **Muted slate / warm off-white** keeps the dashboard readable for long sessions.
- **Monospaced micro-labels** are used only for IDs, system states and operation references.
- **Asymmetric landing layout** makes the product feel designed around roles rather than a generic template.
- **Tactical map treatment** keeps the map visually dominant in the command center.
- **PSS3 / OPS//03 identity** ties the interface directly to the hackathon problem rather than to a generic product style.

## Design language to explain to judges
“We designed the citizen side to be simple and mobile-first, while the command side uses a denser operational-board layout. The visual hierarchy follows emergency priority: location and incident status first, decision-support second, decorative elements last. We intentionally use sharp panels and restrained colors because this is an operations tool, not a marketing dashboard.”

## Important
The redesign changes presentation, hierarchy and visual language. It does not intentionally replace the existing emergency algorithms or workflows.
