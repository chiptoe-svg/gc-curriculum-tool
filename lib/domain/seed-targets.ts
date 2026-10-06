import type { CareerTarget } from './types';

// Definitions as of the 2026-10-06 target batch (owner-approved; spec
// docs/superpowers/specs/2026-10-05-target-5-creative-ops-tech-draft.md §4, §8,
// §9, §12). The live DB is brought to this state by
// scripts/targets/apply-target-batch.ts; scripts/seed-career-targets.ts only
// inserts into an empty DB. Retired sub-competencies are NOT listed under their
// target (they are not current); they live in RETIRED_SUB_COMPETENCIES so the
// apply script can set sub_competencies.retired = true. Rows are never deleted:
// old snapshot_target_coverage cells keep their FK target.

export const CAREER_TARGETS: CareerTarget[] = [
  {
    id: 'account-management',
    name: 'Sales Solutions & Account Management',
    shortDefinition:
      'The solution-seller on the vendor side — sales, account management, technical sales, and customer-service roles at printers, packaging converters, and equipment or technology suppliers. Acts as liaison between the creative/production side and the people deciding what to buy: understands the buyer\'s problem, builds the ROI case, makes the numbers work, and justifies the purchase. Entry-level customer service is this target\'s on-ramp, not a separate track.',
    industryContexts: [
      'Agency account team serving brand clients across print and digital deliverables',
      'In-house brand marketing coordinator translating creative briefs to vendors',
      'Print/packaging sales representative consulting on production specifications',
      'Technical sales or customer-service representative at an equipment or technology supplier, building the ROI case for a prospective buyer',
    ],
    knowDescriptors: [
      'How print, packaging, and production equipment and processes work, and what they can and cannot do',
      'How to build a cost and ROI case: pricing, total cost of ownership, and payback',
      'How buyers, brand clients, and supplier organizations are structured and make purchasing decisions',
    ],
    understandDescriptors: [
      'Why a sale rests on solving the buyer\'s real problem, not on the relationship alone',
      'Why production and technical constraints shape what can be promised',
      'Why credibility with buyers depends on technical and financial fluency',
    ],
    doDescriptors: [
      'Diagnose a buyer\'s or client\'s need and recommend a solution that fits it',
      'Build and present a quantified ROI or cost case for a proposed solution',
      'Manage an account or customer through a full order or project cycle, keeping production aligned',
    ],
    defensibilityNote:
      'Buyers trust people who understand both their problem and the technology well enough to make the numbers work. Diagnosing what a customer actually needs, standing behind a cost case, and keeping the relationship through problems takes technical judgment and accountability that AI can support but not replace.',
    socCode: '41-4012.00',
    subCompetencies: [
      {
        id: 'client-needs-diagnosis',
        name: 'Client needs diagnosis',
        knowDescriptor: 'Knows how to ask questions that surface unstated client needs and how to read project briefs critically.',
        understandDescriptor: 'Understands why stated needs often diverge from underlying business problems and how to navigate that gap.',
        doDescriptor: 'Conducts a discovery conversation that produces a written needs assessment distinct from the original brief.',
      },
      {
        id: 'proposal-development',
        name: 'Proposal development, consultative communication, and the ROI case',
        knowDescriptor: 'Knows the structural elements of a client proposal and the rhythm of consultative communication, and how to build a cost/benefit or ROI case — payback, total cost of ownership, cost-per-unit — that quantifies why a purchase pays for itself.',
        understandDescriptor: 'Understands why a proposal must justify scope, sequence, and cost in business terms — not creative terms — and why a buying decision ultimately rests on a quantified business case, not the relationship alone.',
        doDescriptor: 'Writes and presents a proposal that wins client commitment and sets accurate expectations for delivery, including a quantified ROI or TCO case for the solution being proposed.',
      },
      {
        id: 'project-oversight',
        name: 'Client-facing project coordination',
        knowDescriptor: 'Knows the handoff points between brief, creative, prepress, production and delivery, and which of them need client sign-off.',
        understandDescriptor: 'Understands why the client\'s expectations on timeline, quality and cost have to be managed continuously, and how to communicate trade-offs before they become surprises.',
        doDescriptor: 'Keeps the client and the internal creative and production teams aligned through a project, managing approvals, changes and expectations, while the production side runs the plan.',
      },
      {
        id: 'results-interpretation',
        name: 'Results interpretation and client reporting',
        knowDescriptor: 'Knows the metrics that matter to brand and production clients.',
        understandDescriptor: 'Understands why client reporting frames results in business outcomes, not deliverable counts.',
        doDescriptor: 'Produces a post-project report a client uses to justify continued investment.',
      },
      {
        id: 'gc-production-literacy',
        name: 'Domain literacy in production technology, equipment, and process',
        knowDescriptor: 'Knows what print, packaging, and brand production processes can and cannot accommodate, and what the equipment or technology being sold can and cannot do, well enough to speak to it credibly on the vendor side.',
        understandDescriptor: 'Understands why this knowledge is what differentiates a credible account manager or technical sales rep from an order-taker.',
        doDescriptor: 'Holds a substantive conversation with a brand director or a prospective buyer and turns to brief a production team or a sales engineer accurately.',
      },
    ],
  },
  {
    id: 'brand-strategy',
    name: 'Brand Strategy & Experience',
    shortDefinition:
      'The analytical and strategic layer of marketing — understanding consumers, competitors, and market conditions well enough to define where a brand should position itself and how, and to direct and get the best out of the creative, production, and vendor parties who carry that decision out. Mostly a destination role: the usual entry is a marketing coordinator or specialist position that grows into strategy.',
    industryContexts: [
      'Brand strategist at an agency producing positioning recommendations',
      'In-house brand manager defining campaign objectives and measurement frameworks',
      'Insights analyst translating research into strategic direction',
    ],
    knowDescriptors: [
      'Research methodologies (qualitative and quantitative)',
      'Brand architecture frameworks',
      'Competitive analysis tools',
      'Statistical concepts',
    ],
    understandDescriptors: [
      'Why consumer behavior is contextual and not fully predictable',
      'Why brand positioning requires trade-offs',
      'Why measurement frameworks must align with business objectives',
    ],
    doDescriptors: [
      'Design and execute a consumer research study',
      'Synthesize findings into a strategic recommendation',
      'Evaluate campaign performance against defined objectives',
    ],
    defensibilityNote:
      'AI can process consumer data but cannot make judgment calls about brand voice, cultural resonance, or when a data signal is meaningful versus misleading. Brand strategy requires weighing ambiguous information against business context — which requires human judgment.',
    socCode: '13-1161.00',
    subCompetencies: [
      {
        id: 'consumer-research',
        name: 'Consumer research and insight synthesis',
        knowDescriptor: 'Knows the major qualitative and quantitative research methods and when each is appropriate.',
        understandDescriptor: 'Understands why insight synthesis is interpretive work that requires more than reporting findings.',
        doDescriptor: 'Designs and executes a consumer research study and synthesizes findings into a strategic insight.',
      },
      {
        id: 'competitive-analysis',
        name: 'Competitive and market analysis',
        knowDescriptor: 'Knows competitive analysis frameworks and where to source competitor data.',
        understandDescriptor: 'Understands why competitive context shapes what brand positioning is possible.',
        doDescriptor: 'Produces a competitive analysis that informs a positioning recommendation.',
      },
      {
        id: 'brand-positioning',
        name: 'Brand positioning and messaging strategy',
        knowDescriptor: 'Knows brand architecture frameworks and positioning models.',
        understandDescriptor: 'Understands why positioning requires trade-offs and why a brand cannot stand for everything.',
        doDescriptor: 'Develops a brand positioning recommendation grounded in evidence about consumer and market context.',
      },
      {
        id: 'campaign-measurement',
        name: 'Campaign planning and effectiveness measurement',
        knowDescriptor: 'Knows how campaign measurement frameworks are designed.',
        understandDescriptor: 'Understands why measurement must connect to business objectives, not deliverable activity.',
        doDescriptor: 'Designs a measurement framework for a campaign and evaluates results against objectives.',
      },
      {
        id: 'quantitative-literacy',
        name: 'Quantitative literacy',
        knowDescriptor: 'Knows basic statistical concepts and how to read research outputs critically.',
        understandDescriptor: 'Understands why statistical significance is not the same as practical significance.',
        doDescriptor: 'Interprets research data, identifies signal vs. noise, and translates findings into recommendations.',
      },
      {
        id: 'cross-channel-translation',
        name: 'Cross-channel brand translation (print, packaging, digital)',
        knowDescriptor: 'Knows how a brand standard manifests differently across digital and physical channels.',
        understandDescriptor: 'Understands why cross-channel consistency requires deliberate translation, not duplication.',
        doDescriptor: 'Translates a single brand positioning into coherent execution across print, packaging, and digital.',
      },
    ],
  },
  {
    id: 'production-operations',
    name: 'Production & Operations',
    shortDefinition:
      'The role that makes creative and brand work actually happen — on time, on spec, and within budget, at printers and packaging converters, brand-side production and procurement, and agency production departments. Production managers design and oversee the workflows, quality systems, vendor relationships, logistics, equipment and process decisions, and team and people-management responsibilities (including HR) that translate a creative brief into a finished physical or digital product, and get it delivered.',
    industryContexts: [
      'Production manager at a printer overseeing offset and digital press workflows',
      'In-house operations lead at a brand managing vendor selection and quality',
      'Packaging production specialist on a multi-vendor brand launch',
    ],
    knowDescriptors: [
      'Print and packaging production processes',
      'Quality standards and measurement tools',
      'Vendor capabilities and limitations',
      'Cost structures',
    ],
    understandDescriptors: [
      'Why quality failures happen and how to design systems that catch them earlier',
      'Why timeline management is a people problem as much as a scheduling problem',
      'Why vendor relationships require investment',
    ],
    doDescriptors: [
      'Design a production workflow for a complex multi-component brand project',
      'Evaluate a print proof against specification',
      'Manage a production schedule across multiple vendors under time pressure',
    ],
    defensibilityNote:
      'Production management requires real-time judgment in complex systems with human teams, physical constraints, and unexpected failures. AI can optimize known workflows, but it cannot manage a vendor relationship under pressure, make a quality judgment on a print proof, or navigate the human dynamics of a production floor.',
    socCode: '11-3051.00',
    subCompetencies: [
      {
        id: 'workflow-design',
        name: 'Production workflow design, process engineering, and optimization',
        knowDescriptor: 'Knows the standard workflow patterns for offset, digital, flexo, and packaging production, and the basics of process engineering — re-sequencing, automating, or re-tooling a production process itself to change its throughput, quality, or cost profile.',
        understandDescriptor: 'Understands why workflow design must balance throughput, quality, and adaptability — and why optimizing one trades off another — and why a process re-engineering change (not just a project\'s workflow) needs validation before it replaces a working process.',
        doDescriptor: 'Designs a production workflow for a multi-component project that meets quality, timeline, and budget constraints, or re-engineers a step in an existing production process and validates the change before it replaces what\'s running.',
      },
      {
        id: 'quality-control',
        name: 'Quality control systems and standards enforcement',
        knowDescriptor: 'Knows industry quality standards (G7, ISO 12647, FTA FIRST) and the instruments used to measure conformance.',
        understandDescriptor: 'Understands why quality failures cluster around handoff points and why systems must catch problems earlier than at final inspection.',
        doDescriptor: 'Sets up and operates a quality control system that prevents predictable failure modes for a specific production context.',
      },
      {
        id: 'vendor-management',
        name: 'Vendor selection, management, and relationship maintenance',
        knowDescriptor: 'Knows the capabilities and limitations of the major vendor categories in print and packaging.',
        understandDescriptor: 'Understands why vendor relationships are long-term investments and how trust shapes what vendors will and won\'t do under pressure.',
        doDescriptor: 'Selects, briefs, and manages a vendor through a complex project including specification, delivery, and post-project review.',
      },
      {
        id: 'timeline-management',
        name: 'Timeline management under constraint and pressure',
        knowDescriptor: 'Knows the typical lead-time structure for print and packaging production at varying complexity.',
        understandDescriptor: 'Understands why timeline slippage compounds and why early signals matter more than aggressive deadlines.',
        doDescriptor: 'Manages a production schedule across multiple vendors and surfaces timeline risk early enough to act.',
      },
      {
        id: 'cost-management',
        name: 'Cost estimation, budget management, and equipment justification',
        knowDescriptor: 'Knows the cost structures of major print and packaging processes, and how to build a capital-equipment business case — purchase cost, throughput or quality gain, and payback period — distinct from a per-job estimate.',
        understandDescriptor: 'Understands why cost estimation requires reconciling specification, vendor capability, and run-length economics, and why an equipment decision is judged over a multi-year payback horizon, not a single job\'s margin.',
        doDescriptor: 'Produces a defensible cost estimate for a complex production project and manages spend through to delivery, or builds an equipment-justification case (cost, gain, payback) for a real or proposed purchase.',
      },
      {
        id: 'team-coordination',
        name: 'Team coordination, performance management, and people management (incl. HR)',
        knowDescriptor: 'Knows how production teams are structured and the typical responsibilities at each role, and the basics of the people-management functions that sit alongside day-to-day coordination — hiring, onboarding, and performance/HR policy.',
        understandDescriptor: 'Understands why coordination breaks down under stress and what practices preserve communication, and why hiring and performance-policy decisions have consequences that outlast any single project.',
        doDescriptor: 'Coordinates a production team through a high-pressure project and addresses performance gaps in real time, and carries out at least one people-management task end-to-end (a hire, an onboarding plan, or a documented performance review) for a real or simulated team.',
      },
      {
        id: 'domain-knowledge',
        name: 'Domain knowledge: substrates, color, materials',
        knowDescriptor: 'Knows the major substrate categories, color management systems, and materials used in print and packaging production.',
        understandDescriptor: 'Understands why substrate and ink interactions constrain creative possibility and how to advise designers accordingly.',
        doDescriptor: 'Makes substantive specification decisions on substrate, color, and finishing for a real production project.',
      },
      {
        id: 'project-management',
        name: 'Project management across creative and production work',
        knowDescriptor: 'Knows the project life cycle (scope, plan, schedule, budget, risk, change control, close-out) and the standard tools for each: work breakdown, dependencies, critical path, status reporting.',
        understandDescriptor: 'Understands why projects fail at scope and handoff rather than at execution, and why a plan has to be re-baselined when scope, budget or dates change rather than quietly absorbed.',
        doDescriptor: 'Plans and runs a real creative or production project from brief to delivery: defines scope, builds the schedule and budget, tracks risks and changes, reports status, and closes it out with a lessons-learned record.',
      },
    ],
  },
  {
    id: 'creative-generalist',
    name: 'Purposeful Design & Creative Generalist',
    shortDefinition:
      'A practitioner with broad creative capability across copy, design, photography, video, and print — who uses AI as a force multiplier that makes generalism viable at a professional level.',
    industryContexts: [
      'In-house creative at a small or mid-sized brand producing across all channels',
      'Independent creative producing brand-scale work with AI-augmented workflow',
      'Agency creative bridging copy, design, and motion under one role',
    ],
    knowDescriptors: [
      'How AI generative tools work and where they are reliable versus unreliable',
      'What brand standards govern visual and verbal output',
      'How print production constraints affect digital creative decisions',
    ],
    understandDescriptors: [
      'Why aesthetic judgment cannot be delegated to AI',
      'Why creative iteration requires a human who can evaluate outputs against a brief',
      'Why generalism supported by AI is a strategic position rather than a compromise',
    ],
    doDescriptors: [
      'Take a brand brief from concept through finished output across at least three media using AI-assisted workflow',
      'Evaluate AI-generated outputs against a brand standard and select, reject, or refine',
      'Document a creative workflow that others could replicate',
    ],
    defensibilityNote:
      'AI executes but cannot direct itself. Generative tools require a human who knows what good looks like, what the brand requires, and when an output serves the brief versus when it doesn\'t.',
    socCode: null,
    subCompetencies: [
      {
        id: 'conceptual-development',
        name: 'Conceptual development and creative ideation across disciplines',
        knowDescriptor: 'Knows ideation methods and how to translate a brief into a creative direction.',
        understandDescriptor: 'Understands why conceptual development requires constraint and how to use the brief as the discipline.',
        doDescriptor: 'Develops a creative concept that responds to a brief and translates across at least three executional media.',
      },
      {
        id: 'aesthetic-judgment',
        name: 'Aesthetic judgment and brand visual literacy',
        knowDescriptor: 'Knows the major design principles and how brand standards encode aesthetic decisions.',
        understandDescriptor: 'Understands why aesthetic judgment requires accumulated reference and cannot be reduced to a checklist.',
        doDescriptor: 'Evaluates a body of creative work against a brand standard and identifies what works, what doesn\'t, and why.',
      },
      {
        id: 'ai-tool-direction',
        name: 'AI tool direction and personal tool-building: prompt design, iteration, quality evaluation',
        knowDescriptor: 'Knows the capabilities and failure modes of major generative AI tools across image, copy, and video, and how to script or assemble a lightweight personal AI workflow or tool (a prompt chain, a small automation) to speed their own work.',
        understandDescriptor: 'Understands why AI outputs require iteration grounded in human judgment about what good looks like, and why building a small tool for one\'s own workflow is now baseline fluency for this target — distinct from building a system other people run, which is target 5\'s job.',
        doDescriptor: 'Directs an AI workflow from prompt through final output that meets brand quality standards, and, where useful, builds or configures a small AI tool or automation for their own workflow and documents it well enough to reuse.',
      },
      {
        id: 'cross-medium-production',
        name: 'Cross-medium creative production (copy, design, image, video, print)',
        knowDescriptor: 'Knows the production constraints and standards across the major creative media.',
        understandDescriptor: 'Understands why generalism requires fluency across disciplines, not specialization in any one.',
        doDescriptor: 'Produces finished work across at least three creative media for a single brand project.',
      },
      {
        id: 'brand-standards-application',
        name: 'Brand standards interpretation and application',
        knowDescriptor: 'Knows the typical structure of brand standards documents and what they govern.',
        understandDescriptor: 'Understands why brand standards are guidelines that require interpretation, not rules that mechanically apply.',
        doDescriptor: 'Applies brand standards to a creative deliverable with appropriate judgment about edge cases.',
      },
      {
        id: 'brief-translation',
        name: 'Client brief translation into creative direction',
        knowDescriptor: 'Knows the standard structure of a creative brief and what information it should contain.',
        understandDescriptor: 'Understands why translating a brief into creative direction requires interrogating the brief, not just executing it.',
        doDescriptor: 'Translates a real brand brief into a creative direction that the brief author recognizes as substantively responsive.',
      },
    ],
  },
  {
    id: 'ai-workflow',
    name: 'Creative Technology & Systems',
    shortDefinition:
      'The detail-oriented systems and workflow side of creative and production work — the counterpart to Creative Generalist\'s maker side. Builds and runs the templates, workflow platforms, asset libraries, automations, and compliance checks that creative and production work flows through. Implementing, benchmarking and evaluating AI in those systems is a central part of the role, well beyond using AI tools.',
    industryContexts: [
      'Creative or marketing workflow technologist configuring intake, approvals, and reporting on a platform like Workfront or Monday',
      'Packaging workflow or compliance specialist managing artwork versioning and regulatory/print-quality sign-off',
      'DAM specialist, creative-ops coordinator, or color-management technician governing a brand\'s asset library, color accuracy, or AI-assisted output quality',
      'AI implementation lead selecting, piloting, benchmarking and rolling out AI models and tools across a creative or production operation',
      'IT support specialist keeping the platforms, tools, and data that a creative, marketing, or production team depends on running',
      'Management or systems analyst mapping creative and production processes and specifying the systems that improve them',
    ],
    knowDescriptors: [
      'How workflow platforms, DAM systems, and packaging-artwork pipelines structure creative and production work',
      'What brand, regulatory, and print-quality compliance standards govern packaging and brand asset output',
      'How scripting, APIs, and low-code automation connect creative, workflow, and AI systems',
      'How AI models and tools are selected, implemented, benchmarked and evaluated: test sets, quality and cost measures, failure modes, drift',
    ],
    understandDescriptors: [
      'Why systems and workflow design is what lets creative and production work scale without proportional headcount growth',
      'Why someone has to stay accountable for AI-assisted and automated output against brand, legal, and quality standards',
      'Why an AI tool has to be measured on the organization\'s own work before it is adopted, and re-measured after, rather than trusted on vendor claims',
      'Why color, metadata, and versioning discipline compound in value as volume grows — and compound in cost when missing',
    ],
    doDescriptors: [
      'Configure or design a workflow, template system, or automation for a real creative or production context',
      'Check a packaging, brand, or AI-assisted output against a defined compliance or quality standard and catch failure modes',
      'Implement an AI step in a real workflow and benchmark it against the current process on quality, cost and turnaround, then recommend adopt, adjust or drop',
      'Manage a digital asset library or a color-management process so output stays accurate, findable, and reusable at scale',
    ],
    defensibilityNote:
      'AI can execute steps inside these workflows, but someone has to design the system, decide what the templates and automations should do, and stay accountable when output is checked against brand, legal, or print-quality standards. That accountability, and the judgment behind it, doesn\'t automate.',
    socCode: null,
    subCompetencies: [
      {
        id: 'brand-system-templating',
        name: 'Brand system templating',
        knowDescriptor: 'Knows how brand and campaign rules translate into reusable templates, components, and platform settings — including generative-AI presets — that scale compliant variation.',
        understandDescriptor: 'Understands why templates must encode brand rules precisely enough to produce compliant output automatically, and why they need ongoing monitoring and maintenance as brand rules change.',
        doDescriptor: 'Builds and maintains a template or settings system, in a design tool, workflow platform, or generative-AI platform, that produces on-brand variations at scale, and documents it for others to run.',
      },
      {
        id: 'workflow-architecture',
        name: 'Workflow platform configuration and operation',
        knowDescriptor: 'Knows workflow design patterns and how workflow platforms (e.g., Workfront, Monday) structure intake, approvals, proofing, and reporting, and the role of handoff points in maintaining quality.',
        understandDescriptor: 'Understands why workflows fail at handoff points, and why platform configuration and sequencing matter more than any single tool choice, including AI tools.',
        doDescriptor: 'Configures or designs a workflow — on a real platform or on paper — for a creative or production context, sequencing human and AI work through intake, approval, and reporting steps, for both quality and efficiency.',
      },
      {
        id: 'digital-asset-management',
        name: 'Digital asset management',
        knowDescriptor: 'Knows how DAM platforms organize assets by metadata, taxonomy, and rights, and what makes an asset findable and reusable at scale.',
        understandDescriptor: 'Understands why poor metadata and taxonomy decisions compound as an asset library grows, and why rights tracking is a compliance requirement, not a convenience.',
        doDescriptor: 'Sets up or maintains a metadata/taxonomy structure in a DAM (or DAM-like) system for a real asset library and demonstrates that assets can be found and reused correctly.',
      },
      {
        id: 'packaging-artwork-compliance',
        name: 'Packaging artwork workflow and compliance',
        knowDescriptor: 'Knows the packaging artwork production pipeline — artwork management, versioning, and the regulatory and print-quality requirements that govern packaging graphics.',
        understandDescriptor: 'Understands why packaging compliance failures (labeling errors, missed regulatory requirements) are costly, and why versioning discipline prevents them.',
        doDescriptor: 'Manages a packaging artwork file through versioning and a compliance check — regulatory, brand, or print-quality — using a defined checklist or an AI-assisted review tool.',
      },
      {
        id: 'systems-automation-integration',
        name: 'Systems automation and integration',
        knowDescriptor: 'Knows the basics of scripting, APIs, and low-code automation tools used to connect creative, workflow, and AI systems, and where automation commonly breaks.',
        understandDescriptor: 'Understands why automating a handoff between systems requires understanding both systems\' data and failure modes, not just the happy path.',
        doDescriptor: 'Builds or configures an automation — a script, an API integration, or a low-code workflow — that handles a real handoff between two systems, including a generative-AI step.',
      },
      {
        id: 'color-management',
        name: 'Color management',
        knowDescriptor: 'Knows color-management fundamentals — profiles, calibration, and process control — across the print processes and devices used in GC production.',
        understandDescriptor: 'Understands why color drifts across devices and substrates without active process control, and why color accuracy is a measurable, auditable standard, not a subjective preference.',
        doDescriptor: 'Sets up or audits color management — calibration, profiling, or process control — for a real print or packaging job and demonstrates the job meets a defined color standard.',
      },
      {
        id: 'quality-frameworks',
        name: 'AI and quality governance',
        knowDescriptor: 'Knows the dimensions on which creative, production, and AI-assisted output is evaluated — brand, legal/regulatory, and print-quality standards — and where each kind of check belongs in a workflow.',
        understandDescriptor: 'Understands why quality and compliance checking requires domain expertise and can\'t be fully automated, and why someone must stay accountable for AI-assisted output specifically.',
        doDescriptor: 'Builds or operates a quality/compliance review step in a real workflow — a brand check, a legal/regulatory check, or a print-quality check — that catches failure modes consistently, including checks on AI-assisted output.',
      },
      {
        id: 'ai-tool-evaluation',
        name: 'AI implementation, benchmarking and evaluation',
        knowDescriptor: 'Knows how AI models and tools are chosen and deployed in creative and production operations, and the measures used to judge them: output quality against a reference set, error and failure-mode rates, cost per item, turnaround, and consistency across runs.',
        understandDescriptor: 'Understands why an AI tool must be benchmarked on the organization\'s own work, not vendor demos; why results drift as models change; and how to weigh quality, cost, risk and staff workload in an adopt-or-drop decision.',
        doDescriptor: 'Implements an AI step in a real workflow, builds a small benchmark (a test set and scoring rule) comparing it with the current process, runs it, and writes a recommendation to adopt, adjust or drop, with the evidence.',
      },
      {
        id: 'domain-grounding',
        name: 'Domain grounding: creative, brand and production knowledge',
        knowDescriptor: 'Knows enough of the creative, brand and print/production domain (substrates, color, finishing, brand standards, how creative work is made and approved) to judge whether a workflow, template, automation or AI output is fit for purpose.',
        understandDescriptor: 'Understands why systems built without domain knowledge look correct but fail at the point of use, and why that knowledge is what separates this role from a general IT or automation role.',
        doDescriptor: 'Designs or evaluates a workflow, template system, automation or AI step and shows, with specific domain reasons, where it would succeed or fail in a real creative or production setting.',
      },
    ],
  },
];

/**
 * Sub-competencies retired by an owner decision. They stay in the DB with
 * `retired = true` (never deleted — snapshot_target_coverage, intended
 * coverage and other rows reference them by FK) and are excluded from every
 * current view. Not re-listed under their target above.
 */
export interface RetiredSubCompetency {
  id: string;
  careerTargetId: string;
  retiredOn: string; // ISO date of the decision
  reason: string;
}

export const RETIRED_SUB_COMPETENCIES: RetiredSubCompetency[] = [
  {
    id: 'prompt-design',
    careerTargetId: 'ai-workflow',
    retiredOn: '2026-10-06',
    reason: 'Content-making with AI is target 4\'s territory; covered by creative-generalist/ai-tool-direction (spec §5, §8.4).',
  },
  {
    id: 'change-management',
    careerTargetId: 'ai-workflow',
    retiredOn: '2026-10-06',
    reason: 'Not one of the evidenced strands; training and rollout are covered by ai-tool-evaluation (implementation) (spec §5, §12).',
  },
];
