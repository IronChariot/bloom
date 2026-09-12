import { validateGraph, fromCanvas } from './graph.js';

export function importedGraph(input, filenameTitle = 'Imported brainstorm') {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Expected a board.');
    if (input.format === 'bloom') return validateGraph(input);
    if (input.format !== undefined || !Array.isArray(input.nodes) || !Array.isArray(input.edges)) throw new Error('Unrecognised file format.');
    const title = typeof filenameTitle === 'string' ? filenameTitle.trim().slice(0, 200) : '';
    return fromCanvas(input, title || 'Imported brainstorm');
  } catch {
    throw Object.assign(new Error('This file is not a valid Bloom board or supported JSON Canvas file. The current board has not been replaced.'), { status: 400 });
  }
}
