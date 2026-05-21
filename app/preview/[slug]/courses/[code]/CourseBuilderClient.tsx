'use client';

import { useState } from 'react';
import { CourseInfoTab } from './CourseInfoTab';
import { MaterialsZone } from './MaterialsZone';
import { BuilderProfileTab } from './BuilderProfileTab';
import { KudReviewTab } from './KudReviewTab';
import { CourseAnalyzeZone } from '@/components/CourseAnalyzeZone';
import { CourseProfileEditor } from '@/components/CourseProfileEditor';
import { ProfileRunHistory } from '@/components/ProfileRunHistory';

type Tab = 'info' | 'materials' | 'profile' | 'kuds';

export interface BuilderCourse {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  learningObjectives: string[];
  majorProjects: string[];
  skillsRequired: string[];
  builderStatus: string;
}

export interface BuilderMaterial {
  id: string;
  fileName: string;
  extractionStatus: 'pending' | 'ok' | 'low_text' | 'failed';
  extractionMethod?: string;
  pageCount?: number;
}

export interface BuilderKud {
  thresholdConcept: string;
  know: string[];
  understand: string[];
  do: string[];
  manuallyEdited: boolean;
  sourceRunId: string | null;
  approvedAt: string | null;
}

export interface BuilderKudRun {
  id: string;
  createdAt: string;
  model: string;
  costUsdCents: number;
}

interface Props {
  slug: string;
  course: BuilderCourse;
  materials: BuilderMaterial[];
  currentKud: BuilderKud | null;
  kudRuns: BuilderKudRun[];
  aiProfile: {
    summary: string;
    learningObjectives: string[];
    skills: string[];
    competencies: Array<{ name: string; description: string; level: string; evidence: Array<{ fileName: string; quote: string }> }>;
    catalogDivergence: { reinforced: string[]; additions: string[]; gaps: string[] } | null;
  } | null;
  profileRuns: Array<{ id: string; courseCode: string; materialCount: number; model: string; costUsdCents: number; createdAt: string }>;
  okMaterialCount: number;
  lastProfileRun: { id: string; createdAt: string; materialCount: number; costUsdCents: number } | null;
  aiProfileManuallyEdited: boolean;
  currentProfileRunId: string | null;
}

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: 'info', label: 'Info' },
  { key: 'materials', label: 'Materials' },
  { key: 'profile', label: 'Profile' },
  { key: 'kuds', label: 'KUDs' },
];

export function CourseBuilderClient(props: Props) {
  const { slug, course, materials, currentKud, kudRuns, aiProfile, profileRuns, okMaterialCount, lastProfileRun, aiProfileManuallyEdited, currentProfileRunId } = props;
  const [activeTab, setActiveTab] = useState<Tab>('info');
  const [builderStatus, setBuilderStatus] = useState(course.builderStatus);
  const [kudDraft, setKudDraft] = useState<BuilderKud | null>(currentKud);

  return (
    <div className="space-y-6">
      {/* Tab nav */}
      <div className="flex border-b">
        {TAB_LABELS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === key
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
            {key === 'kuds' && builderStatus === 'approved' && (
              <span className="ml-2 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700">✓</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'info' && (
        <CourseInfoTab course={{ ...course, builderStatus }} />
      )}

      {activeTab === 'materials' && (
        <div className="space-y-6">
          <MaterialsZone courseCode={course.code} slug={slug} initialMaterials={materials} />
          <CourseAnalyzeZone
            slug={slug}
            courseCode={course.code}
            okCount={okMaterialCount}
            lastRun={lastProfileRun}
            manuallyEdited={aiProfileManuallyEdited}
            onAnalyzed={() => {}}
          />
          {aiProfile && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold">AI-synthesized profile</h3>
              <CourseProfileEditor
                courseCode={course.code}
                slug={slug}
                profile={aiProfile}
              />
            </div>
          )}
          <ProfileRunHistory
            runs={profileRuns}
            slug={slug}
            courseCode={course.code}
            currentRunId={currentProfileRunId}
          />
        </div>
      )}

      {activeTab === 'profile' && (
        <BuilderProfileTab
          courseCode={course.code}
          slug={slug}
          initialObjectives={course.learningObjectives}
          initialProjects={course.majorProjects}
          initialSkills={course.skillsRequired}
          builderStatus={builderStatus}
          onSaved={(newStatus) => setBuilderStatus(newStatus)}
        />
      )}

      {activeTab === 'kuds' && (
        <KudReviewTab
          courseCode={course.code}
          slug={slug}
          builderStatus={builderStatus}
          currentKud={kudDraft}
          profileSummary={{
            learningObjectives: course.learningObjectives,
            majorProjects: course.majorProjects,
            skillsRequired: course.skillsRequired,
          }}
          onStatusChange={(newStatus, newKud) => {
            setBuilderStatus(newStatus);
            if (newKud) setKudDraft(newKud);
          }}
        />
      )}
    </div>
  );
}
