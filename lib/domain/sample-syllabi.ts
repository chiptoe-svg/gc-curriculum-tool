export interface SampleSyllabus {
  courseCode: string;
  title: string;
  level: 1 | 2 | 3 | 4;
  syllabusText: string;       // composed: learning objectives + projects + notes
}

export const SAMPLE_SYLLABI: SampleSyllabus[] = [
  {
    courseCode: 'GC 3400',
    title: 'Digital Imaging',
    level: 3,
    syllabusText: `GC 3400 — Digital Imaging (Level 3)

Learning Objectives:
- Digital asset management
- Image capture
- Lighting for products and people
- Ethics and copyright in digital imaging
- Video storytelling
- Short-format video production and editing
- Audio engineering

Projects:
- Photography units: digital asset management, camera settings, photojournalism, Photoshop for photographers, lighting, critique
- Video units: Premiere Pro, editing remix, audio engineering, interview podcast

Assessment context (from curriculum review): This is the clearest Creative Generalist course in the curriculum — photography, video, storytelling, and editing across media. Do-level creative generalist content.`,
  },
  {
    courseCode: 'GC 3460',
    title: 'Ink and Substrates',
    level: 3,
    syllabusText: `GC 3460 — Ink and Substrates (Level 3)

Learning Objectives:
- Ink and substrate manufacturing
- Physical and optical property testing and analysis
- Print metrics and process optimization
- Color theory and separation systems
- Quality control instrumentation
- Proofing systems

Projects:
- Brand Color Report (Pantone color reproduction analysis)
- Ink Formulation
- Substrate Properties Testing
- Ink Properties Testing and Lab Report

Assessment context (from curriculum review): Pure production science. No brand, creative, or management content. Do-level Production & Operations.`,
  },
  {
    courseCode: 'GC 3720',
    title: 'Digital Content & CMS',
    level: 3,
    syllabusText: `GC 3720 — Digital Content & CMS (Level 3, Brand Communications)

Learning Objectives:
- Goal-driven website development with CMS
- Brand-forward digital content creation
- Social marketing channel deployment
- Website conversion techniques
- Website goal measurement
- Presentation skills

Projects:
- Website Design & Development (WordPress)
- Client Research (competitive analysis)
- Website Strategy
- Content Strategy
- Final Presentation

Assessment context: Strongest Brand Strategy course in the curriculum with data. Client research, content strategy, measurement, and brand-forward execution — Do-level brand strategy content.`,
  },
  {
    courseCode: 'GC 4060',
    title: 'Package & Specialty Printing',
    level: 4,
    syllabusText: `GC 4060 — Package & Specialty Printing (Level 4)

Learning Objectives:
- Specialty and package printing processes
- Package design requirements (technical and economic)
- Flexographic workflow
- Prepress functions
- Folding carton and corrugated package design
- Ink/substrate relationship in packaging
- Color correction
- Print quality analysis

Projects:
- Skill-building assignments across specialty printing
- 3-Color Spot Functional Label
- 4-Color and Cold Foil Promotional Label
- Paperboard Project
- Specialty Printing Pieces

Assessment context: Do-level Production & Operations with packaging specialization. One of the strongest technical production courses in the program.`,
  },
  {
    courseCode: 'GC 4070',
    title: 'Advanced Flexography',
    level: 4,
    syllabusText: `GC 4070 — Advanced Flexography (Level 4)

Learning Objectives:
- FTA FIRST certification (Level 1)
- Test target creation
- Bump curves and press curve analysis
- Automated prepress workflows (RIP configurations, trapping, quality control)
- Color management with GMG OpenColor and ICC profiles
- Complex flexographic print jobs with multi-color, coatings, and specialty effects

Projects:
- FIRST Operator Certification
- Test Target Creation
- Plate/Press/PressSync Curve Creation
- Workflow Automation Tickets
- Color Management & Proofing
- Industry Engagement
- Capstone: Press Matching with Custom Profiles

Assessment context: Do-level Production & Operations. The "Workflow Automation: Tickets" project is the only existing course content that touches AI Workflow territory — automated prepress workflow design is a precursor skill. Understand-level AI Workflow.`,
  },
  {
    courseCode: 'GC 4400',
    title: 'Commercial Printing',
    level: 4,
    syllabusText: `GC 4400 — Commercial Printing (Level 4)

Learning Objectives:
- Graphic design for offset/digital press
- Variable data and data management for personalized print
- Typography, copyfitting, and page layout
- Bindery and finishing
- Print-to-digital marketing triggers
- Photographic theories
- Preflighting
- Color management
- Offset and digital press operations
- Plate and press sheet production

Projects:
- Brand Specification Project
- Static Brochure Project
- Business Card with Finishing Embellishments
- Offset Lithographic Press Run
- Variable Data Versioned Booklet
- Brand Story

Assessment context: The broadest senior-level course. Touches Account Management, Brand Strategy, Production & Operations (Do-level press operation), and Creative Generalist. The "Brand Story" project — articulating how marketing collateral fits an integrated campaign — is the closest existing course to brand strategy at Do level.`,
  },
];

export function getSampleByCode(code: string): SampleSyllabus | undefined {
  return SAMPLE_SYLLABI.find(s => s.courseCode === code);
}
