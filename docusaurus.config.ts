import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'OpenMouse Docs',
  tagline: 'Add your device to OpenMouse',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://docs.openmouse.app',
  baseUrl: '/',

  organizationName: 'OpenMouse-Project',
  projectName: 'openmouse',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          routeBasePath: '/', // docs at site root, no separate landing page needed
          editUrl:
            'https://github.com/OpenMouse-Project/openmouse/tree/docs/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'OpenMouse Docs',
      logo: {
        alt: 'OpenMouse Logo',
        src: 'img/logo.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Guide',
        },
        {
          href: 'https://github.com/OpenMouse-Project',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Guide',
          items: [
            {label: 'Architecture', to: '/architecture'},
            {label: 'Add a Device', to: '/add-a-device/overview'},
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'GitHub', href: 'https://github.com/OpenMouse-Project'},
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} OpenMouse. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript', 'rust'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
