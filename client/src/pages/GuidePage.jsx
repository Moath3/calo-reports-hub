import {
  FileText, Upload, Brain, Eye, Download, Globe, Settings,
  Plus, Sparkles, Palette, List, HelpCircle, ChevronRight
} from 'lucide-react';

const steps = [
  {
    icon: Upload,
    title: 'Upload Your Data',
    desc: 'Go to "New Report" and drag & drop your file (Excel, CSV, JSON, HTML, or Text). The system will parse and preview your data automatically.',
    tips: ['Supported formats: .xlsx, .xls, .csv, .json, .html, .txt, .md', 'Max file size: 25 MB', 'You can also create a blank report without uploading data']
  },
  {
    icon: Brain,
    title: 'Generate with AI',
    desc: 'Choose an AI provider (Claude, Gemini, or Perplexity) and click "Generate with AI". The AI will analyze your data and create a professional report with sections, metrics, tables, and insights.',
    tips: ['Add custom instructions to guide the AI (e.g. "Focus on monthly trends")', 'Claude is recommended for best results', 'You can skip AI and build the report manually']
  },
  {
    icon: FileText,
    title: 'Edit Your Report',
    desc: 'The report editor lets you visually edit every part of your report. Use the Sections tab to add, remove, reorder sections and blocks.',
    tips: [
      'Block types: Badge, Notes, Metrics, Table, Key-Value, Comparison, Callout, Image, Link',
      'Use the arrow buttons on blocks to reorder them',
      'Use the General Info tab to set title, date, brand color, and KPI strip'
    ]
  },
  {
    icon: Sparkles,
    title: 'Use AI Assistant',
    desc: 'Switch to the "AI Assistant" tab in the editor to chat with AI about your report. You can ask it to fill sections, improve text, add data, or restructure content.',
    tips: [
      'Upload additional files directly in the AI chat (click the paperclip icon)',
      'Paste raw data using the clipboard icon',
      'Use quick actions like "Improve all sections" or "Add executive summary"',
      'The AI can update your report sections in real-time'
    ]
  },
  {
    icon: Eye,
    title: 'Preview & Export',
    desc: 'Click "Preview" to see your report as it will appear when exported. From the preview page you can export or publish.',
    tips: [
      'PDF: Click the PDF button to open print dialog (save as PDF)',
      'HTML: Download a standalone HTML file with collapsible sections',
      'Publish: Deploy directly to Netlify for a public URL',
      'Copy HTML: Copy the report HTML to clipboard'
    ]
  },
  {
    icon: Palette,
    title: 'Templates',
    desc: 'Save your report structure as a template and reuse it later. Browse existing templates in the Templates page.',
    tips: ['Templates save the section structure without specific data', 'Share templates across the team']
  },
];

export default function GuidePage() {
  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-in">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
          <HelpCircle className="h-7 w-7 text-green-600" />
          How to Use CALO Reports Hub
        </h1>
        <p className="text-sm text-gray-500 mt-1">A step-by-step guide for creating professional reports</p>
      </div>

      {/* Quick overview */}
      <div className="card p-5 bg-green-50 border-green-200">
        <h2 className="font-semibold text-green-800 mb-2">Quick Start</h2>
        <div className="flex items-center gap-2 text-sm text-green-700 flex-wrap">
          {['Upload Data', 'Configure AI', 'Generate Report', 'Edit & Refine', 'Export / Publish'].map((s, i) => (
            <span key={s} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-green-400" />}
              <span className="bg-white px-2.5 py-1 rounded-full font-medium border border-green-200">{s}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={i} className="card overflow-hidden">
            <div className="flex items-center gap-4 px-5 py-4 bg-gray-50 border-b border-gray-100">
              <div className="h-10 w-10 rounded-xl bg-green-100 flex items-center justify-center shrink-0">
                <step.icon className="h-5 w-5 text-green-700" />
              </div>
              <div>
                <div className="text-xs text-gray-400 font-medium">Step {i + 1}</div>
                <div className="font-semibold text-gray-900">{step.title}</div>
              </div>
            </div>
            <div className="p-5">
              <p className="text-sm text-gray-600 mb-3">{step.desc}</p>
              <ul className="space-y-1.5">
                {step.tips.map((tip, j) => (
                  <li key={j} className="text-sm text-gray-500 flex items-start gap-2">
                    <span className="text-green-500 mt-0.5 shrink-0">&#x2022;</span>
                    {tip}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      {/* Block types reference */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
          <List className="h-5 w-5 text-green-600" /> Block Types Reference
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            { name: 'Badge', desc: 'Colored label/header for section highlights' },
            { name: 'Notes', desc: 'Bullet points or paragraph text' },
            { name: 'Metrics', desc: 'Grid of metric cards with values and trends' },
            { name: 'Table', desc: 'Data table with editable headers and rows' },
            { name: 'Key-Value', desc: 'Key-value pair list for quick stats' },
            { name: 'Comparison', desc: 'Side-by-side dual-column comparison' },
            { name: 'Callout', desc: 'Highlighted announcement or emphasis box' },
            { name: 'Image', desc: 'Upload an image or add by URL with caption' },
            { name: 'Link', desc: 'Clickable link with text and description' },
          ].map(bt => (
            <div key={bt.name} className="flex items-start gap-2 p-2.5 rounded-lg bg-gray-50">
              <span className="badge-green text-[10px] mt-0.5 shrink-0">{bt.name}</span>
              <span className="text-xs text-gray-600">{bt.desc}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Tips */}
      <div className="card p-5 bg-amber-50 border-amber-200">
        <h2 className="font-semibold text-amber-800 mb-2">Pro Tips</h2>
        <ul className="space-y-1.5 text-sm text-amber-700">
          <li>&#x2022; Save your work frequently using the Save button in the editor</li>
          <li>&#x2022; Use the AI Assistant to quickly populate sections with uploaded data</li>
          <li>&#x2022; Brand color affects the entire report theme (header, tables, accents)</li>
          <li>&#x2022; Published HTML reports have collapsible sections - click section titles to toggle</li>
          <li>&#x2022; For PDF export, use Chrome's "Save as PDF" option in the print dialog</li>
          <li>&#x2022; Contact your admin if your account is pending approval</li>
        </ul>
      </div>
    </div>
  );
}
