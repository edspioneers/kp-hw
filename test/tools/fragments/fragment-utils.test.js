import { expect } from '@esm-bundle/chai';
import {
  buildListUrl,
  toSiteRelativePath,
  stripHtmlExt,
  buildFragmentPath,
  toItems,
  buildBreadcrumbs,
  escapeHtml,
  buildInsertHtml,
  buildPreviewUrl,
} from '../../../tools/fragments/fragment-utils.js';

describe('fragment-utils.js', () => {
  describe('buildListUrl', () => {
    it('builds the DA admin list URL for a path', () => {
      const url = buildListUrl('edspioneers', 'kp-hw', '/fragments/nav');
      expect(url).to.equal('https://admin.da.live/list/edspioneers/kp-hw/fragments/nav');
    });
  });

  describe('toSiteRelativePath', () => {
    it('strips the org/repo prefix from a DA-absolute path', () => {
      const result = toSiteRelativePath('/edspioneers/kp-hw/fragments/nav', 'edspioneers', 'kp-hw');
      expect(result).to.equal('/fragments/nav');
    });

    it('returns the path unchanged when the prefix does not match', () => {
      const result = toSiteRelativePath('/other/path', 'edspioneers', 'kp-hw');
      expect(result).to.equal('/other/path');
    });
  });

  describe('stripHtmlExt', () => {
    it('removes a trailing .html extension', () => {
      expect(stripHtmlExt('/fragments/404.html')).to.equal('/fragments/404');
    });

    it('leaves paths without .html unchanged', () => {
      expect(stripHtmlExt('/fragments/nav')).to.equal('/fragments/nav');
    });
  });

  describe('buildFragmentPath', () => {
    it('strips both the org/repo prefix and the .html extension', () => {
      const result = buildFragmentPath('/edspioneers/kp-hw/fragments/nav/main-nav.html', 'edspioneers', 'kp-hw');
      expect(result).to.equal('/fragments/nav/main-nav');
    });
  });

  describe('toItems', () => {
    const daItems = [
      {
        path: '/edspioneers/kp-hw/fragments/404.html', name: '404', ext: 'html', lastModified: 1,
      },
      { path: '/edspioneers/kp-hw/fragments/promos', name: 'promos' },
      { path: '/edspioneers/kp-hw/fragments/nav', name: 'nav' },
      {
        path: '/edspioneers/kp-hw/fragments/tabs-example.html', name: 'tabs-example', ext: 'html', lastModified: 2,
      },
      {
        path: '/edspioneers/kp-hw/fragments/config.json', name: 'config', ext: 'json', lastModified: 3,
      },
    ];

    it('sorts folders first (alphabetically), then files (alphabetically)', () => {
      const items = toItems(daItems, 'edspioneers', 'kp-hw');
      expect(items.map((item) => item.name)).to.deep.equal(['nav', 'promos', '404', 'tabs-example']);
    });

    it('marks folders and files with the correct type', () => {
      const items = toItems(daItems, 'edspioneers', 'kp-hw');
      expect(items.find((item) => item.name === 'nav').type).to.equal('folder');
      expect(items.find((item) => item.name === '404').type).to.equal('file');
    });

    it('filters out items with a non-html extension', () => {
      const items = toItems(daItems, 'edspioneers', 'kp-hw');
      expect(items.some((item) => item.name === 'config')).to.equal(false);
    });

    it('converts folder paths to site-relative form', () => {
      const items = toItems(daItems, 'edspioneers', 'kp-hw');
      expect(items.find((item) => item.name === 'nav').path).to.equal('/fragments/nav');
    });

    it('converts file paths to site-relative form without the .html extension', () => {
      const items = toItems(daItems, 'edspioneers', 'kp-hw');
      expect(items.find((item) => item.name === '404').path).to.equal('/fragments/404');
    });
  });

  describe('buildBreadcrumbs', () => {
    it('returns a single root crumb for the fragments root', () => {
      expect(buildBreadcrumbs('/fragments')).to.deep.equal([
        { label: 'Fragments', path: '/fragments' },
      ]);
    });

    it('returns one crumb per path segment below the root', () => {
      const crumbs = buildBreadcrumbs('/fragments/nav/deep');
      expect(crumbs).to.deep.equal([
        { label: 'Fragments', path: '/fragments' },
        { label: 'nav', path: '/fragments/nav' },
        { label: 'deep', path: '/fragments/nav/deep' },
      ]);
    });
  });

  describe('escapeHtml', () => {
    it('escapes HTML-significant characters', () => {
      expect(escapeHtml('<a>&"</a>')).to.equal('&lt;a&gt;&amp;&quot;&lt;/a&gt;');
    });
  });

  describe('buildInsertHtml', () => {
    it('wraps a fragment link in its own paragraph, path as both href and text', () => {
      const html = buildInsertHtml('/fragments/nav/main-nav');
      expect(html).to.equal('<p><a href="/fragments/nav/main-nav">/fragments/nav/main-nav</a></p>');
    });
  });

  describe('buildPreviewUrl', () => {
    it('builds an aem.page preview URL for the given ref/repo/org', () => {
      const url = buildPreviewUrl('/fragments/nav/main-nav', 'edspioneers', 'kp-hw', 'main');
      expect(url).to.equal('https://main--kp-hw--edspioneers.aem.page/fragments/nav/main-nav');
    });

    it('defaults to the main ref when none is given', () => {
      const url = buildPreviewUrl('/fragments/404', 'edspioneers', 'kp-hw');
      expect(url).to.equal('https://main--kp-hw--edspioneers.aem.page/fragments/404');
    });
  });
});
