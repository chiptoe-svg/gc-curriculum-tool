# Manning (2025) — Education Agent Skills Library

**Full citation:** Manning, G. (2025). *Education Agent Skills Library* — an open GitHub-based library of procedural skill definitions for curriculum-design and assessment AI agents, organized into domains (curriculum-alignment, curriculum-assessment, AI literacy, etc.) with each skill providing a structured SKILL.md describing inputs, outputs, and procedural steps. https://github.com/GarethManning/education-agent-skills.

**Reference ID in background.html:** `ref-manning-skills`; cited in §10.

**Where it lives:**
- URL: https://github.com/GarethManning/education-agent-skills
- Open-access status: Open (CC BY-SA 4.0 license).

**Accessibility:** Verified accessible — GitHub README fully readable; repository structure browsable.

**What the background doc claims it says:** Manning's *Education Agent Skills Library* is used as an implementation scaffold for encoding established pedagogical reasoning (backward design, assessment validity, evidence-first planning) into AI agent behavior. The specific skills named in the doc (Backwards Design, KUD Chart Authoring, Coverage Audit, Developmental Band Translator, Assessment Validity Checker, Disciplinary AI Literacy, KUD Knowledge Type Mapper) are read at design time and their reasoning frameworks are embodied directly in prompt bodies. Manning's library is the implementation artifact through which scholarly grounding is applied to AI agent behavior — it frames the analytical question; KUD+ supplies the answer space.

**What it actually says (synthesis):** The Education Agent Skills Library is an open-source repository maintained by Gareth Manning, described as an educator, curriculum designer, and learning systems designer. As of the repository's current state, it contains 165 evidence-based pedagogical skills across 20 domains, available under the CC BY-SA 4.0 license.

Each skill is a folder containing a `SKILL.md` file with a machine-readable YAML header (including skill ID, domain, evidence strength, evidence sources, typed input/output schemas, chaining metadata, and tags) followed by a procedural prompt body. Skills are organized into domains covering teacher and designer-facing applications (Domains 1–19) and student-facing AI interaction patterns (Domain 20). The library is compliant with the Agent Skills 1.0 open standard, and skills are designed to work with Claude Code, Claude.ai (via MCP), and OpenAI Codex.

The README explicitly frames the library's purpose as building "a credible, rigorous foundation for AI in education" that is "anchored in named research, honest about its limitations." Each skill cites the research it operationalizes via the evidence sources field in the YAML header. The library acts as a structured translation layer between established pedagogical research and AI agent prompt engineering: it takes established frameworks (backward design, constructive alignment, KUD charting, coverage auditing) and packages them as executable procedural definitions that an AI agent can follow.

The library is not itself a research document or a validation of KUD+. It is an implementation artifact that organizes existing pedagogical knowledge into AI-executable form. The skills in the curriculum-alignment and curriculum-assessment domains are the most directly relevant to the KUD+ framework application in the GC Curriculum Tool.

**Verdict:** Consistent. The background doc is precise and accurate about what Manning's library is: an implementation scaffold, not an independent scholarly source that validates KUD+. The doc explicitly states "Manning's library is the implementation artifact" and that the scholarly grounding comes from the pedagogical research the prompts operationalize. This is an honest characterization of the library's role. One minor note: the background doc describes the library as having a "structured SKILL.md describing inputs, outputs, and procedural steps" — this matches the current repository structure accurately.
