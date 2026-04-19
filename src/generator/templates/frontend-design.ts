import type { ProjectModel } from '../../types';

/**
 * @template frontend-design
 * @description Skill definition for distinctive, production-grade frontend design.
 */
export const FrontendDesignSkill = (model: ProjectModel) => ({
  type: 'skill' as const,
  path: '.github/roadie/skills/frontend-design.md',
  content: 
`---
name: frontend-design
description: Create distinctive, production-grade frontend interfaces with high design quality. Use this skill when building web components, pages, artifacts, or applications.
---

# Frontend Design Manifesto: The Anti-Slop Policy

This skill guides the creation of distinctive, production-grade frontend interfaces that avoid generic "AI slop" aesthetics. Every generation must feel genuinely designed.

## 🧠 Design Thinking
Before coding, commit to a BOLD aesthetic direction:
- **Tone**: Pick an extreme (Minimalist, Maximalist, Retro-Futuristic, Luxury, Brutalist, Editorial). Execute with intentionality.
- **Memorable Factor**: What is the one thing the user will remember about this UI?

## 💅 Aesthetics Guidelines
- **Typography**: NEVER use Arial, Inter, or system fonts. Pair a distinctive display font (e.g., Serif, Monospace, or high-character Sans) with a refined body font.
- **Color**: Aggressive, cohesive signatures. Dominant colors with sharp accents. No timid "grey on white" defaults.
- **Motion**: Orchestrate high-impact reveals. Use staggered delays and hover states that surprise.
- **Composition**: Break the grid. Use asymmetry, diagonal flow, and overlaps. Avoid "box-in-a-box" cookie-cutter layouts.
- **Texture**: Add atmospheric depth. Use gradient meshes, noise overlays, geometric patterns, or layered transparencies to avoid flat, lifeless colors.

**CRITICAL**: Match implementation complexity to the vision. Maximalist ideas need elaborate code; minimalist ideas need mathematical precision in spacing.

## 🚫 The Forbidden List (NEVER USE)
- Generic fonts (Inter, Roboto, Arial, System).
- Cliched "SaaS Blue" or "AI Purple" gradients on white.
- Predictable component patterns (Standard cards, basic grid).
- Flat, context-less "MVP" aesthetics.

_Roadie Enforcement: Every UI generated while this skill is active must be a unique design statement._`
});
