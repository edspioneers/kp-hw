import { expect } from '@esm-bundle/chai';
import {
  buildSourceUrl,
  resolveTemplateFromHtml,
  parseContentDaUrl,
  findTemplateEntry,
  extractSections,
  countBlockOccurrences,
  computeSectionStatuses,
  computeAddedBlocks,
  findReferenceBlockHtml,
  extractMetadataFields,
  checkPageMetadata,
  diffSets,
  buildBlockTableHtml,
} from '../../../tools/template-governance/template-governance-utils.js';

describe('template-governance-utils.js', () => {
  describe('buildSourceUrl', () => {
    it('builds a DA source URL for a path', () => {
      expect(buildSourceUrl('/index-copy', 'edspioneers', 'kp-hw')).to.equal('https://content.da.live/edspioneers/kp-hw/index-copy');
    });
  });

  describe('resolveTemplateFromHtml', () => {
    it('reads the template name from the .metadata block', () => {
      const html = `
        <html><body><main><div>
          <div class="metadata">
            <div><div><p>title</p></div><div><p>Home</p></div></div>
            <div><div><p>template</p></div><div><p>Homepage</p></div></div>
          </div>
        </div></main></body></html>
      `;
      expect(resolveTemplateFromHtml(html)).to.equal('Homepage');
    });

    it('returns null when there is no .metadata block', () => {
      expect(resolveTemplateFromHtml('<html><body><main></main></body></html>')).to.equal(null);
    });
  });

  describe('parseContentDaUrl', () => {
    it('parses org, repo, and path from a content.da.live URL', () => {
      const result = parseContentDaUrl('https://content.da.live/adobedrago/ak-kaiserpermanente/docs/library/templates/homepage');
      expect(result).to.deep.equal({
        org: 'adobedrago',
        repo: 'ak-kaiserpermanente',
        path: '/docs/library/templates/homepage',
      });
    });

    it('returns null for a URL that is not a content.da.live URL', () => {
      expect(parseContentDaUrl('https://example.com/adobedrago/kp-hw/foo')).to.equal(null);
    });
  });

  describe('findTemplateEntry', () => {
    const entries = [
      { key: 'Homepage', value: 'https://content.da.live/adobedrago/ak-kaiserpermanente/docs/library/templates/homepage' },
      { key: 'Support', value: 'https://content.da.live/adobedrago/ak-kaiserpermanente/docs/library/templates/support' },
    ];

    it('finds an entry by key, case-insensitively', () => {
      expect(findTemplateEntry(entries, 'homepage')).to.deep.equal(entries[0]);
    });

    it('returns null when no entry matches', () => {
      expect(findTemplateEntry(entries, 'article')).to.equal(null);
    });
  });

  describe('extractSections', () => {
    it('returns one entry per section with its blocks in order and the section style', () => {
      const html = `
        <html><body><main>
          <div>
            <div class="hero landing"><div>content</div></div>
            <div class="section-metadata"><div><div><p>style</p></div><div><p>full-width</p></div></div></div>
          </div>
          <div>
            <div class="columns"><div>a</div></div>
          </div>
        </main></body></html>
      `;
      expect(extractSections(html)).to.deep.equal([
        { style: 'full-width', blocks: ['hero'], defaultContent: [] },
        { style: null, blocks: ['columns'], defaultContent: [] },
      ]);
    });

    it('excludes the page metadata block from a section\'s blocks', () => {
      const html = `
        <html><body><main>
          <div>
            <div class="columns"><div>a</div></div>
            <div class="metadata"><div><div><p>title</p></div><div><p>Home</p></div></div></div>
          </div>
        </main></body></html>
      `;
      expect(extractSections(html)).to.deep.equal([{ style: null, blocks: ['columns'], defaultContent: [] }]);
    });

    it('records multiple block instances within one section in order, not deduplicated', () => {
      const html = `
        <html><body><main>
          <div>
            <div class="card"><div>a</div></div>
            <div class="card"><div>b</div></div>
            <div class="card"><div>c</div></div>
          </div>
        </main></body></html>
      `;
      expect(extractSections(html)).to.deep.equal([{ style: null, blocks: ['card', 'card', 'card'], defaultContent: [] }]);
    });

    it('returns an empty array when there is no main element', () => {
      expect(extractSections('<html><body></body></html>')).to.deep.equal([]);
    });

    it('records the tag names of default (non-block) content, deduplicated and in order', () => {
      const html = `
        <html><body><main>
          <div>
            <h2>Heading</h2>
            <p>First paragraph</p>
            <p>Second paragraph</p>
          </div>
        </main></body></html>
      `;
      expect(extractSections(html)).to.deep.equal([{ style: null, blocks: [], defaultContent: ['h2', 'p'] }]);
    });

    it('records both default content and blocks in the same section', () => {
      const html = `
        <html><body><main>
          <div>
            <h2>Intro</h2>
            <p>Some text</p>
            <div class="columns"><div>a</div></div>
          </div>
        </main></body></html>
      `;
      expect(extractSections(html)).to.deep.equal([
        { style: null, blocks: ['columns'], defaultContent: ['h2', 'p'] },
      ]);
    });

    it('does not count section-metadata or the page metadata block as default content', () => {
      const html = `
        <html><body><main>
          <div>
            <p>Some text</p>
            <div class="section-metadata"><div><div><p>style</p></div><div><p>full-width</p></div></div></div>
            <div class="metadata"><div><div><p>title</p></div><div><p>Home</p></div></div></div>
          </div>
        </main></body></html>
      `;
      expect(extractSections(html)).to.deep.equal([
        { style: 'full-width', blocks: [], defaultContent: ['p'] },
      ]);
    });
  });

  describe('countBlockOccurrences', () => {
    it('sums block occurrences across all sections', () => {
      const sections = [
        { style: null, blocks: ['hero'] },
        { style: null, blocks: ['columns'] },
        { style: null, blocks: ['columns'] },
      ];
      expect(countBlockOccurrences(sections)).to.deep.equal({ hero: 1, columns: 2 });
    });

    it('returns an empty object for no sections', () => {
      expect(countBlockOccurrences([])).to.deep.equal({});
    });
  });

  describe('computeSectionStatuses', () => {
    it('marks a single-occurrence block present when the page has it', () => {
      const reference = [{ style: null, blocks: ['columns-media'] }];
      const current = [{ style: null, blocks: ['columns-media'] }];
      const statuses = computeSectionStatuses(reference, current);
      expect(statuses).to.deep.equal([
        { style: null, referenceIndex: 0, blocks: [{ name: 'columns-media', status: 'present' }] },
      ]);
    });

    it('marks a single-occurrence block missing when the page lacks it', () => {
      const reference = [{ style: null, blocks: ['tabs'] }];
      const statuses = computeSectionStatuses(reference, []);
      expect(statuses).to.deep.equal([
        { style: null, referenceIndex: 0, blocks: [{ name: 'tabs', status: 'missing' }] },
      ]);
    });

    it('matches a present block to its true position instead of an earlier occurrence of the same name', () => {
      // The template has hero at position 1 (landing) and position 3 (later in the
      // page). The page only kept the later one — surrounded by the same "columns"
      // neighbor as the template — so that's the occurrence that must read "present",
      // not position 1. This is the exact case a simple per-name counter gets backwards.
      const reference = [
        { style: null, blocks: ['hero'] },
        { style: null, blocks: ['columns'] },
        { style: null, blocks: ['hero'] },
      ];
      const current = [
        { style: null, blocks: ['columns'] },
        { style: null, blocks: ['hero'] },
      ];
      const statuses = computeSectionStatuses(reference, current);
      expect(statuses.map((s) => s.blocks[0].status)).to.deep.equal(['missing', 'present', 'present']);
    });

    it('matches repeated-block instances to the earliest reference slots when nothing else distinguishes them', () => {
      const reference = [
        { style: null, blocks: ['columns'] },
        { style: null, blocks: ['columns'] },
        { style: null, blocks: ['columns'] },
      ];
      const current = [
        { style: null, blocks: ['columns'] },
        { style: null, blocks: ['columns'] },
      ];
      const statuses = computeSectionStatuses(reference, current);
      expect(statuses.map((s) => s.blocks[0].status)).to.deep.equal(['present', 'present', 'missing']);
    });

    it('marks every slot of a repeated block present once fully satisfied', () => {
      const reference = [
        { style: null, blocks: ['columns'] },
        { style: null, blocks: ['columns'] },
      ];
      const current = [
        { style: null, blocks: ['columns'] },
        { style: null, blocks: ['columns'] },
      ];
      const statuses = computeSectionStatuses(reference, current);
      expect(statuses.map((s) => s.blocks[0].status)).to.deep.equal(['present', 'present']);
    });

    it('marks every slot of a repeated block missing when the page has none', () => {
      const reference = [
        { style: null, blocks: ['hero'] },
        { style: null, blocks: ['hero'] },
      ];
      const statuses = computeSectionStatuses(reference, []);
      expect(statuses.map((s) => s.blocks[0].status)).to.deep.equal(['missing', 'missing']);
    });

    it('allocates independently across multiple instances of the same block within one section', () => {
      const reference = [{ style: null, blocks: ['card', 'card', 'card'] }];
      const current = [{ style: null, blocks: ['card'] }];
      const statuses = computeSectionStatuses(reference, current);
      expect(statuses[0].blocks.map((b) => b.status)).to.deep.equal(['present', 'missing', 'missing']);
    });

    it('omits sections with no real content block', () => {
      const reference = [
        { style: null, blocks: ['hero'] },
        { style: 'footnotes', blocks: [] },
      ];
      const current = [{ style: null, blocks: ['hero'] }];
      const statuses = computeSectionStatuses(reference, current);
      expect(statuses).to.have.lengthOf(1);
    });

    it('preserves the original reference index when an earlier section is filtered out', () => {
      const reference = [
        { style: 'footnotes', blocks: [] },
        { style: null, blocks: ['hero'] },
      ];
      const current = [{ style: null, blocks: ['hero'] }];
      const statuses = computeSectionStatuses(reference, current);
      expect(statuses).to.have.lengthOf(1);
      expect(statuses[0].referenceIndex).to.equal(1);
    });
  });

  describe('computeAddedBlocks', () => {
    it('returns block names present on the page but absent from the reference', () => {
      expect(computeAddedBlocks({ hero: 1, 'promo-banner': 1 }, { hero: 1 })).to.deep.equal(['promo-banner']);
    });

    it('returns an empty array when nothing is added', () => {
      expect(computeAddedBlocks({ hero: 1 }, { hero: 2 })).to.deep.equal([]);
    });
  });

  describe('findReferenceBlockHtml', () => {
    it('returns the outer HTML of the first matching block', () => {
      const html = `
        <html><body><main>
          <div><div class="hero"><div>content</div></div></div>
        </main></body></html>
      `;
      expect(findReferenceBlockHtml(html, 'hero')).to.equal('<div class="hero"><div>content</div></div>');
    });

    it('returns null when no block matches', () => {
      const html = '<html><body><main><div><div class="hero"></div></div></main></body></html>';
      expect(findReferenceBlockHtml(html, 'tabs')).to.equal(null);
    });

    it('returns null when there is no main element', () => {
      expect(findReferenceBlockHtml('<html><body></body></html>', 'hero')).to.equal(null);
    });
  });

  describe('extractMetadataFields', () => {
    it('extracts the key from each row of the .metadata block', () => {
      const html = `
        <html><body><main><div>
          <div class="metadata">
            <div><div><p>title</p></div><div><p>Home</p></div></div>
            <div><div><p>template</p></div><div><p>Homepage</p></div></div>
          </div>
        </div></main></body></html>
      `;
      expect(extractMetadataFields(html)).to.deep.equal(['title', 'template']);
    });

    it('returns an empty array when there is no .metadata block', () => {
      expect(extractMetadataFields('<html><body><main></main></body></html>')).to.deep.equal([]);
    });
  });

  describe('checkPageMetadata', () => {
    function html(metadataRows, { lastSection = true } = {}) {
      const metadataBlock = `<div class="metadata">${metadataRows
        .map(([key, value]) => `<div><div><p>${key}</p></div><div><p>${value}</p></div></div>`)
        .join('')}</div>`;
      const metadataSection = `<div>${metadataBlock}</div>`;
      const otherSection = '<div><div class="columns"><div>a</div></div></div>';
      const sections = lastSection ? [otherSection, metadataSection] : [metadataSection, otherSection];
      return `<html><body><main>${sections.join('')}</main></body></html>`;
    }

    const complete = [['template', 'Homepage'], ['title', 'Home'], ['image', 'hero.png']];

    it('reports present, last, and complete when all required fields exist in the last section', () => {
      expect(checkPageMetadata(html(complete))).to.deep.equal({
        present: true,
        isLast: true,
        missingFields: [],
      });
    });

    it('reports missing entirely when there is no .metadata block', () => {
      const noMeta = '<html><body><main><div><div class="columns"><div>a</div></div></div></main></body></html>';
      expect(checkPageMetadata(noMeta)).to.deep.equal({
        present: false,
        isLast: false,
        missingFields: ['template', 'title', 'image'],
      });
    });

    it('reports not last when the metadata block is not the final section', () => {
      const result = checkPageMetadata(html(complete, { lastSection: false }));
      expect(result.present).to.equal(true);
      expect(result.isLast).to.equal(false);
    });

    it('reports missing fields, case-insensitively matched, when required fields are absent', () => {
      const result = checkPageMetadata(html([['Template', 'Homepage']]));
      expect(result.present).to.equal(true);
      expect(result.missingFields).to.deep.equal(['title', 'image']);
    });

    it('returns all fields missing when there is no main element', () => {
      expect(checkPageMetadata('<html><body></body></html>')).to.deep.equal({
        present: false,
        isLast: false,
        missingFields: ['template', 'title', 'image'],
      });
    });
  });

  describe('diffSets', () => {
    it('reports reference names missing from the current set', () => {
      const { missing } = diffSets(['hero'], ['hero', 'columns']);
      expect(missing).to.deep.equal(['columns']);
    });

    it('reports current names not present in the reference set', () => {
      const { added } = diffSets(['hero', 'extra-block'], ['hero']);
      expect(added).to.deep.equal(['extra-block']);
    });

    it('reports no findings when the sets match exactly', () => {
      expect(diffSets(['hero'], ['hero'])).to.deep.equal({ missing: [], added: [] });
    });
  });

  describe('buildBlockTableHtml', () => {
    it('builds a table with a single-cell name row and one row per block row', () => {
      const blockHtml = '<div class="columns"><div><div>a</div><div>b</div></div><div><div>c</div><div>d</div></div></div>';
      const table = buildBlockTableHtml(blockHtml);
      expect(table).to.equal(
        '<table><tr><td colspan="2">columns</td></tr><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>',
      );
    });

    it('joins additional classes into the name row in parens', () => {
      const blockHtml = '<div class="columns two-up"><div><div>a</div></div></div>';
      const table = buildBlockTableHtml(blockHtml);
      expect(table).to.equal('<table><tr><td colspan="1">columns (two-up)</td></tr><tr><td>a</td></tr></table>');
    });

    it('treats a row with no cell divs as a single cell using the row\'s own inner HTML', () => {
      const blockHtml = '<div class="hero"><div><h1>Title</h1></div></div>';
      const table = buildBlockTableHtml(blockHtml);
      expect(table).to.equal('<table><tr><td colspan="1">hero</td></tr><tr><td><h1>Title</h1></td></tr></table>');
    });

    it('uses a cell\'s inner HTML as the td content, not the cell div itself', () => {
      const blockHtml = '<div class="tabs"><div><div><p>Tab content</p></div></div></div>';
      const table = buildBlockTableHtml(blockHtml);
      expect(table).to.equal('<table><tr><td colspan="1">tabs</td></tr><tr><td><p>Tab content</p></td></tr></table>');
    });

    it('returns null when the input has no element to parse', () => {
      expect(buildBlockTableHtml('')).to.equal(null);
    });
  });
});
