import type { CareerTarget } from './types';

export const CAREER_TARGETS: CareerTarget[] = [
  {
    id: 'account-management',
    name: 'Account Management',
    shortDefinition:
      'The consultative client-facing role that bridges a brand\'s marketing intent and the production or creative execution required to realize it.',
    industryContexts: [
      'Agency account team serving brand clients across print and digital deliverables',
      'In-house brand marketing coordinator translating creative briefs to vendors',
      'Print/packaging sales representative consulting on production specifications',
    ],
    knowDescriptors: [
      'How print and packaging production processes work',
      'What brand standards govern visual consistency',
      'How agency and client organizations are structured',
    ],
    understandDescriptors: [
      'Why client relationships require ongoing trust investment',
      'Why production constraints shape creative possibility',
      'Why the account manager\'s credibility depends on domain knowledge',
    ],
    doDescriptors: [
      'Manage a client relationship through a full project cycle',
      'Translate a brand brief into a production specification',
      'Present results in terms that matter to the client',
    ],
    defensibilityNote:
      'Trust, relationship continuity, and organizational navigation are not automatable. Understanding what a client actually needs (as opposed to what they asked for) requires human judgment and accumulated context that AI cannot replicate.',
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
        name: 'Proposal development and consultative communication',
        knowDescriptor: 'Knows the structural elements of a client proposal and the rhythm of consultative communication.',
        understandDescriptor: 'Understands why a proposal must justify scope, sequence, and cost in business terms — not creative terms.',
        doDescriptor: 'Writes and presents a proposal that wins client commitment and sets accurate expectations for delivery.',
      },
      {
        id: 'project-oversight',
        name: 'Project oversight across creative and production workflows',
        knowDescriptor: 'Knows the standard handoff points between brief, creative, prepress, production, and delivery.',
        understandDescriptor: 'Understands why timeline and quality trade-offs are continuous decisions, not one-time choices.',
        doDescriptor: 'Manages a project through its full cycle while keeping client, creative, and production teams aligned.',
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
        name: 'Domain literacy in print, packaging, and brand production',
        knowDescriptor: 'Knows what print, packaging, and brand production processes can and cannot accommodate.',
        understandDescriptor: 'Understands why this knowledge is what differentiates a credible account manager from an order-taker.',
        doDescriptor: 'Holds a substantive conversation with a brand director and turns to brief a production team accurately.',
      },
    ],
  },
  {
    id: 'brand-strategy',
    name: 'Brand Strategy',
    shortDefinition:
      'The analytical and strategic layer of marketing — understanding consumers, competitors, and market conditions well enough to define where a brand should position itself and how.',
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
      'The role that makes creative and brand work actually happen — on time, on spec, and within budget. Production managers design and oversee the workflows, quality systems, vendor relationships, and team coordination that translate a creative brief into a finished physical or digital product.',
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
        name: 'Production workflow design and optimization',
        knowDescriptor: 'Knows the standard workflow patterns for offset, digital, flexo, and packaging production.',
        understandDescriptor: 'Understands why workflow design must balance throughput, quality, and adaptability — and why optimizing one trades off another.',
        doDescriptor: 'Designs a production workflow for a multi-component project that meets quality, timeline, and budget constraints.',
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
        name: 'Cost estimation and budget management',
        knowDescriptor: 'Knows the cost structures of major print and packaging processes.',
        understandDescriptor: 'Understands why cost estimation requires reconciling specification, vendor capability, and run-length economics.',
        doDescriptor: 'Produces a defensible cost estimate for a complex production project and manages spend through to delivery.',
      },
      {
        id: 'team-coordination',
        name: 'Team coordination and performance management',
        knowDescriptor: 'Knows how production teams are structured and the typical responsibilities at each role.',
        understandDescriptor: 'Understands why coordination breaks down under stress and what practices preserve communication.',
        doDescriptor: 'Coordinates a production team through a high-pressure project and addresses performance gaps in real time.',
      },
      {
        id: 'domain-knowledge',
        name: 'Domain knowledge: substrates, color, materials',
        knowDescriptor: 'Knows the major substrate categories, color management systems, and materials used in print and packaging production.',
        understandDescriptor: 'Understands why substrate and ink interactions constrain creative possibility and how to advise designers accordingly.',
        doDescriptor: 'Makes substantive specification decisions on substrate, color, and finishing for a real production project.',
      },
    ],
  },
  {
    id: 'creative-generalist',
    name: 'Creative Generalist / AI-Native',
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
        name: 'AI tool direction: prompt design, iteration, quality evaluation',
        knowDescriptor: 'Knows the capabilities and failure modes of major generative AI tools across image, copy, and video.',
        understandDescriptor: 'Understands why AI outputs require iteration grounded in human judgment about what good looks like.',
        doDescriptor: 'Directs an AI workflow from prompt through final output that meets brand quality standards.',
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
    name: 'AI Workflow / Orchestrator',
    shortDefinition:
      'The person who designs, builds, and manages the AI-augmented workflows that allow creative and production organizations to scale output without proportionally scaling headcount.',
    industryContexts: [
      'Workflow designer at an agency rolling out AI-assisted production',
      'Operations lead at a brand integrating AI tools into existing creative workflows',
      'Independent consultant building AI workflows for small creative shops',
    ],
    knowDescriptors: [
      'How major AI tools (generative image, copy, video, layout) work and where they fail',
      'What workflow design principles apply to creative production contexts',
      'How to document workflows so they can be maintained and improved',
    ],
    understandDescriptors: [
      'Why AI tool outputs require domain-expert evaluation',
      'Why workflow design is a continuous improvement process, not a one-time build',
      'Why change management is the hardest part of AI adoption',
    ],
    doDescriptors: [
      'Design and document an AI-augmented workflow for a specific creative or production context',
      'Evaluate the output of an AI-assisted workflow against a quality standard and identify where revision is needed',
      'Train a small team to operate a documented AI workflow',
    ],
    defensibilityNote:
      'This role requires both domain expertise and technical fluency — the combination is rare. An AI workflow designer who doesn\'t understand creative and production work will build workflows that produce technically correct but creatively wrong outputs.',
    socCode: null,
    subCompetencies: [
      {
        id: 'ai-tool-evaluation',
        name: 'AI tool evaluation: capabilities, limitations, and appropriate use cases',
        knowDescriptor: 'Knows the major categories of generative and analytical AI tools and their current capabilities.',
        understandDescriptor: 'Understands why tool selection must match the specific creative or production problem, and why default tool choices fail in specialized contexts.',
        doDescriptor: 'Evaluates a set of AI tools against a specific use case and recommends a stack with defensible rationale.',
      },
      {
        id: 'workflow-architecture',
        name: 'Workflow architecture: sequencing human and AI work',
        knowDescriptor: 'Knows workflow design patterns and the role of handoff points in maintaining quality.',
        understandDescriptor: 'Understands why workflows fail at handoff points and why sequencing matters more than tool choice.',
        doDescriptor: 'Designs a workflow for a real creative or production context that sequences human and AI work for both quality and efficiency.',
      },
      {
        id: 'prompt-design',
        name: 'Prompt design, testing, and documentation',
        knowDescriptor: 'Knows the principles of effective prompt design and how prompts behave across models.',
        understandDescriptor: 'Understands why prompts are versioned artifacts that require testing and maintenance, not one-time text.',
        doDescriptor: 'Writes, tests, and documents prompts that produce consistent outputs across a real production workflow.',
      },
      {
        id: 'quality-frameworks',
        name: 'Quality evaluation frameworks for AI output',
        knowDescriptor: 'Knows the dimensions on which AI output quality is evaluated in creative and production contexts.',
        understandDescriptor: 'Understands why quality evaluation requires domain expertise and cannot be fully automated.',
        doDescriptor: 'Builds a quality review process for an AI-assisted workflow that catches failure modes consistently.',
      },
      {
        id: 'change-management',
        name: 'Change management for AI workflow adoption',
        knowDescriptor: 'Knows the standard models of change management and the typical resistance patterns in creative teams.',
        understandDescriptor: 'Understands why adoption fails when the workflow is technically sound but socially unsupported.',
        doDescriptor: 'Manages a small team through adoption of a new AI workflow without losing output quality.',
      },
      {
        id: 'domain-grounding',
        name: 'Domain grounding: creative, brand, and production knowledge',
        knowDescriptor: 'Knows enough of the underlying creative and production domain to evaluate whether an AI output is fit for purpose.',
        understandDescriptor: 'Understands why domain ignorance produces workflows that look correct but fail at the point of use.',
        doDescriptor: 'Designs an AI workflow that reflects credible domain knowledge of the creative or production context it serves.',
      },
    ],
  },
];
