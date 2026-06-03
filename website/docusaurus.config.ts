import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'MCP Playground',
  tagline: 'Build, run, and debug multi-MCP workflows on a visual canvas',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://hardikcode-creator.github.io',
  // Project site lives under the repo name, so assets must be served from
  // /MCP-Playground/. (For a root-domain host like Vercel/Netlify, set this to '/'.)
  baseUrl: '/MCP-Playground/',

  organizationName: 'hardikcode-creator',
  projectName: 'MCP-Playground',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  // Mermaid diagrams in Markdown code fences.
  // `format: 'detect'` keeps .md files as CommonMark (robust against stray
  // braces/angle-brackets) while .mdx files use full MDX/JSX.
  markdown: {
    mermaid: true,
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      {
        docs: {
          // The doc content lives next to the project (MCP-Playground/docs),
          // not inside the website folder, so docs are a first-class repo artifact.
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
        },
        // This is a single, cohesive technical document - no blog.
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/favicon.svg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    mermaid: {
      theme: {light: 'neutral', dark: 'dark'},
    },
    navbar: {
      title: 'MCP Playground',
      logo: {
        alt: 'MCP Playground',
        src: 'img/favicon.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Technical Doc',
        },
        {
          href: 'https://github.com/hardikcode-creator/MCP-Playground',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Document',
          items: [
            {label: 'Overview', to: '/'},
            {label: 'The Executor Engine', to: '/executor-engine'},
            {label: 'Live Example', to: '/live-example-dashboard'},
          ],
        },
        {
          title: 'Project',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/hardikcode-creator/MCP-Playground',
            },
            {
              label: 'Model Context Protocol',
              href: 'https://modelcontextprotocol.io',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} MCP Playground: Nutanix Hackathon.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
