'use client';

export default function CourseDetailError({ error }: { error: Error & { digest?: string } }) {
  return (
    <main className="mx-auto max-w-4xl p-6 md:p-12 space-y-4">
      <h1 className="text-xl font-semibold text-destructive">Something went wrong loading this course</h1>
      <pre className="text-sm bg-muted p-4 rounded overflow-auto whitespace-pre-wrap">{error.message}</pre>
      {error.digest && <p className="text-xs text-muted-foreground">Digest: {error.digest}</p>}
    </main>
  );
}
