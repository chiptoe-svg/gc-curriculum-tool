interface CourseInfo {
  code: string;
  title: string;
  level: number;
  track: string;
  description: string;
  prerequisites: string;
  builderStatus: string;
}

interface Props {
  course: CourseInfo;
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  materials_uploaded: 'Materials uploaded',
  profile_complete: 'Profile complete',
  kuds_generated: 'KUDs generated',
  approved: 'Approved',
};

const STATUS_CLASS: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  materials_uploaded: 'bg-amber-100 text-amber-700',
  profile_complete: 'bg-amber-100 text-amber-700',
  kuds_generated: 'bg-blue-100 text-blue-700',
  approved: 'bg-green-100 text-green-700',
};

export function CourseInfoTab({ course }: Props) {
  const statusLabel = STATUS_LABEL[course.builderStatus] ?? course.builderStatus;
  const statusClass = STATUS_CLASS[course.builderStatus] ?? 'bg-muted text-muted-foreground';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${statusClass}`}>
          {statusLabel}
        </span>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Code</dt>
          <dd className="mt-1 text-sm font-mono">{course.code}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Level</dt>
          <dd className="mt-1 text-sm">{course.level}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Track</dt>
          <dd className="mt-1 text-sm">{course.track}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Prerequisites (catalog)</dt>
          <dd className="mt-1 text-sm">{course.prerequisites || 'None listed'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</dt>
          <dd className="mt-1 text-sm leading-relaxed">{course.description || 'No catalog description.'}</dd>
        </div>
      </dl>
    </div>
  );
}
