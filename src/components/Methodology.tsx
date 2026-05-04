import { marked } from 'marked';
import { useEffect, useState } from 'react';

export function Methodology(): JSX.Element {
  const [html, setHtml] = useState('');

  useEffect(() => {
    // Dynamic import keeps the ?raw query out of module-parse time so the
    // tsx-based prerender step (which doesn't support Vite's ?raw) never sees it.
    // Vite inlines the file content in the bundle, so there is no network fetch.
    import('../../METHODOLOGY.md?raw').then(({ default: content }) => {
      setHtml(marked.parse(content) as string);
    });
  }, []);

  return (
    <div
      className="prose prose-slate max-w-2xl dark:prose-invert"
      // Content is sourced from our own METHODOLOGY.md — not user input.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
