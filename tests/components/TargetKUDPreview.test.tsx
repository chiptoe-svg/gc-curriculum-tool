import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TargetKUDPreview } from '@/components/TargetKUDPreview';
import type { CareerTarget } from '@/lib/domain/types';

const target: CareerTarget = {
  id: 'production-operations',
  name: 'Production Operations',
  shortDefinition: 'def',
  industryContexts: [],
  knowDescriptors: [],
  understandDescriptors: [],
  doDescriptors: [],
  defensibilityNote: 'note',
  socCode: null,
  subCompetencies: [
    {
      id: 'press-mechanics',
      name: 'Press Mechanics',
      knowDescriptor: 'press parts',
      understandDescriptor: 'wear patterns',
      doDescriptor: 'troubleshoot a jam',
    },
  ],
};

describe('TargetKUDPreview', () => {
  it('renders collapsed by default', () => {
    render(<TargetKUDPreview slug="slug" target={target} />);
    expect(screen.getByText(/Current Know \/ Understand \/ Do/i)).toBeInTheDocument();
    expect(screen.queryByText('press parts')).toBeNull();
  });
  it('expands when the header is clicked', () => {
    render(<TargetKUDPreview slug="slug" target={target} />);
    fireEvent.click(screen.getByText(/Current Know \/ Understand \/ Do/i));
    expect(screen.getByText('press parts')).toBeInTheDocument();
    expect(screen.getByText('wear patterns')).toBeInTheDocument();
    expect(screen.getByText('troubleshoot a jam')).toBeInTheDocument();
  });
  it('includes an "Edit this target" link to the correct editor URL', () => {
    render(<TargetKUDPreview slug="my-slug" target={target} />);
    fireEvent.click(screen.getByText(/Current Know \/ Understand \/ Do/i));
    const link = screen.getByRole('link', { name: /Edit this target/i });
    expect(link.getAttribute('href')).toBe('/preview/my-slug/targets/production-operations');
  });
  it('renders nothing if target is null', () => {
    const { container } = render(<TargetKUDPreview slug="slug" target={null} />);
    expect(container.firstChild).toBeNull();
  });
});
