import type { ProjectModel } from '../../types';

/**
 * @template engineering-rigor
 * @description Skill definition for professional-grade engineering rigor (GSD Protocol).
 */
export const EngineeringRigorSkill = (model: ProjectModel) => ({
  type: 'skill' as const,
  path: '.roadie/skills/engineering-rigor.md',
  content: 
`---
name: engineering-rigor
description: Enforce professional-grade engineering rigor using the GSD Protocol. Use this skill for complex features, systemic bug fixes, or architectural changes.
---

# Engineering Rigor Manifesto: The GSD Protocol

This skill transforms "lazy agent logic" into professional-grade engineering rigor. Load this skill when "good enough" is not enough.

## 🎯 Spec-Driven Development (SDD) LAW (Extreme Rigor)
Never write implementation code until the **Observable State** is defined.
1. **Goal-Backward / Exit-Condition First**: Define exactly what must be true (Observable Truth) before any tool call.
2. **Adversarial Red-Teaming**: Before implementation, list 3 ways your plan could fail and create mitigations.
3. **Contextual Bankruptcy**: Hard-reset context at 80% saturation. Summarize key facts before clearing cache.

## 🧪 Scientific Debugging Protocol
Forbidden: Proposing fixes based on "guessing" or "it might be X".
1. **Falsifiability**: State your hypothesis: "X causes Y because Z".
2. **The Falsification Test**: Define a test that would PROVE the hypothesis WRONG. Execute it.
3. **Reasoning Checkpoint (YAML)**: Before any code is changed, write this to a scratch file:
   \`\`\`yaml
   reasoning_checkpoint:
     hypothesis: "[Your falsifiable hypothesis]"
     confirming_evidence: ["[Direct observation from tools]"]
     falsification_test: "[Test that would prove you wrong]"
     fix_rationale: "[Why this addresses the root cause mechanics]"
   \`\`\`
4. **Metacognitive Steering**: If a fix fails twice, you MUST stop and re-read foundational logs. Do not "retry" without a fresh perspective.

## 📐 Interface-First Engineering (Wave 0)
1. **Definition Wave**: Before implementing logic, define all **Interfaces, Types, and Exports**.
2. **Contract Locking**: Once Wave 0 is committed, implementation must strictly adhere to the contract. Changes to the contract require a new Wave 0.

## 🔁 The EPIC Loop (Level 4 Rigor)
1. **Explore**: Map dependencies and identify the **Impact Zone**.
2. **Plan**: Goal-Backward + Red-Team Analysis.
3. **Implement**: Wave 0 (Contracts) → Wave 1+ (Scientific TDD).
4. **Commit**: Surgical Summary + Evidence of success.`
});
