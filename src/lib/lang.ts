const MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php',
  json: 'json', md: 'markdown', html: 'html', css: 'css', scss: 'scss', less: 'less',
  yml: 'yaml', yaml: 'yaml', xml: 'xml', sql: 'sql', sh: 'shell', bash: 'shell', zsh: 'shell',
  toml: 'ini', ini: 'ini', dockerfile: 'dockerfile', graphql: 'graphql', vue: 'html', svelte: 'html',
};

export function languageFor(path: string): string {
  const base = path.split('/').pop()!.toLowerCase();
  if (base === 'dockerfile') return 'dockerfile';
  return MAP[base.split('.').pop() ?? ''] ?? 'plaintext';
}
