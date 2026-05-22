'use client';

import { useState, useEffect } from 'react';
import { UploadZone, type UploadedMaterial } from './UploadZone';
import { MaterialsList } from './MaterialsList';
import { CanvasImportZone } from '@/components/CanvasImportZone';

interface Props {
  courseCode: string;
  slug: string;
  initialMaterials: UploadedMaterial[];
  onOkCountChange?: (count: number) => void;
}

export function MaterialsZone({ courseCode, slug, initialMaterials, onOkCountChange }: Props) {
  const [materials, setMaterials] = useState<UploadedMaterial[]>(initialMaterials);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    onOkCountChange?.(materials.filter((m) => m.extractionStatus === 'ok').length);
  }, [materials, onOkCountChange]);

  function handleUploaded(material: UploadedMaterial) {
    setMaterials((prev) => [...prev, material]);
  }

  async function handleDelete(id: string) {
    setDeleting(id);
    try {
      const res = await fetch(
        `/api/courses/${encodeURIComponent(courseCode)}/materials/${id}?slug=${encodeURIComponent(slug)}`,
        { method: 'DELETE' },
      );
      if (res.ok) {
        setMaterials((prev) => prev.filter((m) => m.id !== id));
      }
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      <UploadZone courseCode={courseCode} slug={slug} onUploaded={handleUploaded} />
      <CanvasImportZone courseCode={courseCode} slug={slug} onImported={handleUploaded} />
      <MaterialsList
        courseCode={courseCode}
        slug={slug}
        materials={materials}
        onDelete={handleDelete}
        deleting={deleting}
      />
    </>
  );
}
