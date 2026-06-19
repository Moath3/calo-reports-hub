import { v4 as uuid } from 'uuid';
import bcrypt from 'bcryptjs';
import { getDb } from './database.js';
import { BCRYPT_COST } from '../middleware/auth.js';

const HR_TEMPLATE = {
  generalInfo: {
    title: "HR Performance Report",
    reportDate: "",
    companyName: "CALO",
    brandColor: "#02B376",
    prevMonth: "",
    kpiStrip: [
      { label: "Total Headcount", value: "0", unit: "", trend: "stable" },
      { label: "New Hires", value: "0", unit: "", trend: "up" },
      { label: "Turnover Rate", value: "0%", unit: "", trend: "down" },
      { label: "Open Positions", value: "0", unit: "", trend: "stable" },
      { label: "Avg Tenure", value: "0 yrs", unit: "", trend: "up" }
    ]
  },
  sections: [
    {
      title: "Workforce Overview",
      icon: "👥",
      blocks: [
        { type: "badge", label: "Workforce Overview", style: "green" },
        { type: "metrics", items: [
          { label: "Total Employees", value: "0", change: "", trend: "stable" },
          { label: "Full-Time", value: "0", change: "", trend: "stable" },
          { label: "Part-Time", value: "0", change: "", trend: "stable" },
          { label: "Contractors", value: "0", change: "", trend: "stable" }
        ]},
        { type: "comparison", label: "Department Breakdown", leftTitle: "Operations", rightTitle: "Corporate",
          leftRows: [
            { key: "Production", value: "0" },
            { key: "Logistics", value: "0" },
            { key: "Quality", value: "0" },
            { key: "Warehouse", value: "0" }
          ],
          rightRows: [
            { key: "HR", value: "0" },
            { key: "Finance", value: "0" },
            { key: "Marketing", value: "0" },
            { key: "IT", value: "0" }
          ]
        }
      ]
    },
    {
      title: "Recruitment & Hiring",
      icon: "🎯",
      blocks: [
        { type: "badge", label: "Recruitment Update", style: "blue" },
        { type: "metrics", items: [
          { label: "Applications Received", value: "0", change: "", trend: "up" },
          { label: "Interviews Conducted", value: "0", change: "", trend: "up" },
          { label: "Offers Made", value: "0", change: "", trend: "stable" },
          { label: "Positions Filled", value: "0", change: "", trend: "up" }
        ]},
        { type: "table", label: "Recent Hires", headers: ["Name", "Department", "Position", "Start Date"], rows: [
          ["", "", "", ""]
        ]},
        { type: "notes", label: "Recruitment Notes", items: ["Add recruitment highlights and pipeline notes here"] }
      ]
    },
    {
      title: "Employee Engagement & Retention",
      icon: "💡",
      blocks: [
        { type: "badge", label: "Engagement Metrics", style: "amber" },
        { type: "metrics", items: [
          { label: "Engagement Score", value: "0%", change: "", trend: "up" },
          { label: "eNPS Score", value: "0", change: "", trend: "stable" },
          { label: "Retention Rate", value: "0%", change: "", trend: "up" },
          { label: "Absenteeism Rate", value: "0%", change: "", trend: "down" }
        ]},
        { type: "notes", label: "Engagement Highlights", items: [
          "Add key engagement findings here",
          "Add retention initiatives here"
        ]}
      ]
    },
    {
      title: "Training & Development",
      icon: "📚",
      blocks: [
        { type: "badge", label: "L&D Update", style: "blue" },
        { type: "metrics", items: [
          { label: "Training Hours", value: "0", change: "", trend: "up" },
          { label: "Programs Completed", value: "0", change: "", trend: "up" },
          { label: "Certifications Earned", value: "0", change: "", trend: "stable" },
          { label: "Budget Utilized", value: "0%", change: "", trend: "stable" }
        ]},
        { type: "table", label: "Upcoming Programs", headers: ["Program", "Department", "Date", "Participants"], rows: [
          ["", "", "", ""]
        ]}
      ]
    },
    {
      title: "Compensation & Benefits",
      icon: "💰",
      blocks: [
        { type: "badge", label: "Comp & Benefits", style: "green" },
        { type: "keyvalue", label: "Key Metrics", items: [
          { key: "Average Salary", value: "" },
          { key: "Benefits Enrollment Rate", value: "" },
          { key: "Payroll Cost (Monthly)", value: "" },
          { key: "Overtime Hours", value: "" }
        ]},
        { type: "notes", label: "Compensation Notes", items: ["Add compensation updates and market benchmarking notes"] }
      ]
    },
    {
      title: "Compliance & Policy",
      icon: "📋",
      blocks: [
        { type: "badge", label: "Compliance Status", style: "green" },
        { type: "notes", label: "Policy Updates", items: [
          "Add any policy changes or compliance updates",
          "Add audit findings or pending actions"
        ]},
        { type: "callout", title: "Compliance Score", value: "0%", icon: "✅" }
      ]
    },
    {
      title: "Key HR Initiatives",
      icon: "🚀",
      blocks: [
        { type: "badge", label: "Strategic Initiatives", style: "blue" },
        { type: "notes", label: "Current Initiatives", items: [
          "Add ongoing HR projects and status",
          "Add upcoming plans and milestones"
        ]}
      ]
    }
  ],
  summary: "",
  insights: []
};

const PRODUCTION_TEMPLATE = {
  generalInfo: {
    title: "KSA MARKET GROWTH UPDATE",
    reportDate: "",
    companyName: "CALO",
    brandColor: "#02B376",
    prevMonth: "",
    kpiStrip: [
      { label: "Total KSA", value: "0", unit: "meals", trend: "up" },
      { label: "Riyadh MP", value: "0", unit: "meals", trend: "up" },
      { label: "West MP", value: "0", unit: "meals", trend: "up" },
      { label: "Fleet Size", value: "0", unit: "vehicles", trend: "stable" },
      { label: "Core Capacity", value: "0", unit: "meals/day", trend: "up" }
    ]
  },
  sections: [
    {
      title: "Core Delivery Capacity",
      icon: "📦",
      blocks: [
        { type: "badge", label: "Core Delivery Capacity", style: "green" },
        { type: "notes", label: "Capacity Overview", items: [
          "Add core delivery capacity highlights here",
          "Add capacity utilization data"
        ]},
        { type: "comparison", label: "Regional Capacity", leftTitle: "Riyadh", rightTitle: "Jeddah",
          leftRows: [
            { key: "Daily Capacity", value: "0" },
            { key: "Utilization", value: "0%" },
            { key: "Peak Load", value: "0" }
          ],
          rightRows: [
            { key: "Daily Capacity", value: "0" },
            { key: "Utilization", value: "0%" },
            { key: "Peak Load", value: "0" }
          ]
        },
        { type: "table", label: "Weekly Production Summary", headers: ["Day", "Riyadh", "Jeddah", "Total", "vs Target"], rows: [
          ["Sun", "0", "0", "0", ""],
          ["Mon", "0", "0", "0", ""],
          ["Tue", "0", "0", "0", ""],
          ["Wed", "0", "0", "0", ""],
          ["Thu", "0", "0", "0", ""]
        ]}
      ]
    },
    {
      title: "Ramadan Capacity Planning",
      icon: "🌙",
      blocks: [
        { type: "badge", label: "Ramadan Readiness", style: "amber" },
        { type: "notes", label: "Planning Notes", items: [
          "Add Ramadan capacity planning details",
          "Add special menu considerations"
        ]},
        { type: "callout", title: "Ramadan Target Capacity", value: "0 meals/day", icon: "🌙" },
        { type: "comparison", label: "Pre-Ramadan vs Ramadan", leftTitle: "Current", rightTitle: "Ramadan Target",
          leftRows: [
            { key: "Daily Output", value: "0" },
            { key: "Menu Items", value: "0" },
            { key: "Delivery Windows", value: "0" }
          ],
          rightRows: [
            { key: "Daily Output", value: "0" },
            { key: "Menu Items", value: "0" },
            { key: "Delivery Windows", value: "0" }
          ]
        }
      ]
    },
    {
      title: "Non-Core Delivery — B2B & Calo Cafe",
      icon: "🏢",
      blocks: [
        { type: "badge", label: "B2B & Cafe", style: "blue" },
        { type: "metrics", items: [
          { label: "B2B Orders", value: "0", change: "", trend: "up" },
          { label: "Cafe Orders", value: "0", change: "", trend: "up" },
          { label: "B2B Revenue", value: "0", change: "", trend: "up" },
          { label: "Cafe Revenue", value: "0", change: "", trend: "up" }
        ]},
        { type: "table", label: "B2B Client Summary", headers: ["Client", "Orders", "Revenue", "Status"], rows: [
          ["", "", "", ""]
        ]}
      ]
    },
    {
      title: "7-Day Delivery & Customization Performance",
      icon: "📊",
      blocks: [
        { type: "badge", label: "Delivery Performance", style: "green" },
        { type: "comparison", label: "Delivery Metrics", leftTitle: "This Week", rightTitle: "Last Week",
          leftRows: [
            { key: "On-Time Rate", value: "0%" },
            { key: "Customization Rate", value: "0%" },
            { key: "Customer Rating", value: "0/5" }
          ],
          rightRows: [
            { key: "On-Time Rate", value: "0%" },
            { key: "Customization Rate", value: "0%" },
            { key: "Customer Rating", value: "0/5" }
          ]
        },
        { type: "comparison", label: "Regional Performance", leftTitle: "Riyadh", rightTitle: "Jeddah",
          leftRows: [
            { key: "Deliveries", value: "0" },
            { key: "Success Rate", value: "0%" },
            { key: "Avg Time", value: "0 min" }
          ],
          rightRows: [
            { key: "Deliveries", value: "0" },
            { key: "Success Rate", value: "0%" },
            { key: "Avg Time", value: "0 min" }
          ]
        },
        { type: "metrics", items: [
          { label: "Total Deliveries", value: "0", change: "", trend: "up" },
          { label: "Success Rate", value: "0%", change: "", trend: "up" },
          { label: "Custom Meals", value: "0%", change: "", trend: "up" },
          { label: "Avg Delivery Time", value: "0m", change: "", trend: "down" }
        ]}
      ]
    },
    {
      title: "Logistics Update",
      icon: "🚚",
      blocks: [
        { type: "badge", label: "Logistics", style: "blue" },
        { type: "metrics", items: [
          { label: "Fleet Size", value: "0", change: "", trend: "stable" },
          { label: "Active Routes", value: "0", change: "", trend: "up" },
          { label: "Fuel Cost", value: "0", change: "", trend: "down" },
          { label: "Maintenance", value: "0", change: "", trend: "stable" }
        ]},
        { type: "notes", label: "Logistics Notes", items: ["Add fleet and logistics updates here"] }
      ]
    },
    {
      title: "Campaign & Expansion",
      icon: "📈",
      blocks: [
        { type: "badge", label: "Growth & Campaigns", style: "green" },
        { type: "comparison", label: "Campaign Performance", leftTitle: "Current Campaign", rightTitle: "Previous Campaign",
          leftRows: [
            { key: "Reach", value: "0" },
            { key: "Conversions", value: "0" },
            { key: "New Customers", value: "0" }
          ],
          rightRows: [
            { key: "Reach", value: "0" },
            { key: "Conversions", value: "0" },
            { key: "New Customers", value: "0" }
          ]
        },
        { type: "notes", label: "Expansion Notes", items: ["Add market expansion updates and city launch plans"] }
      ]
    },
    {
      title: "B Cities Weekly Delivery Summary",
      icon: "🏙️",
      blocks: [
        { type: "badge", label: "B Cities Performance", style: "amber" },
        { type: "notes", label: "B Cities Overview", items: [
          "Add B-tier city delivery performance",
          "Add growth metrics for expansion cities"
        ]},
        { type: "keyvalue", label: "City Summary", items: [
          { key: "Dammam", value: "0 deliveries" },
          { key: "Khobar", value: "0 deliveries" },
          { key: "Makkah", value: "0 deliveries" },
          { key: "Madinah", value: "0 deliveries" }
        ]}
      ]
    },
    {
      title: "People Update",
      icon: "👤",
      blocks: [
        { type: "badge", label: "People Update", style: "blue" },
        { type: "notes", label: "Team Updates", items: [
          "Add team hiring and staffing updates",
          "Add key people changes and announcements"
        ]}
      ]
    }
  ],
  summary: "",
  insights: []
};

export function seedDefaultTemplates() {
  const db = getDb();

  // Check if default templates already exist
  const existing = db.prepare("SELECT COUNT(*) as count FROM templates WHERE is_default = 1").get();
  if (existing.count > 0) return;

  console.log('  Seeding default templates...');

  // HR Template
  const hrId = uuid();
  db.prepare(
    "INSERT INTO templates (id, user_id, name, description, category, template_data, is_default, is_shared, usage_count) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(
    hrId, null,
    "HR Performance Report",
    "Comprehensive HR report template with workforce overview, recruitment, engagement, training, compensation, compliance, and key initiatives sections.",
    "hr",
    JSON.stringify(HR_TEMPLATE),
    1, 1, 0
  );

  // Production Template
  const prodId = uuid();
  db.prepare(
    "INSERT INTO templates (id, user_id, name, description, category, template_data, is_default, is_shared, usage_count) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(
    prodId, null,
    "KSA Market Growth Update",
    "Production and market growth report template with delivery capacity, Ramadan planning, B2B & Cafe, logistics, campaigns, B-cities, and people updates.",
    "production",
    JSON.stringify(PRODUCTION_TEMPLATE),
    1, 1, 0
  );

  console.log('  Default templates seeded: HR + Production');
}

export async function seedAdminUser() {
  const db = getDb();
  // Credentials come from env — never hardcoded (the old literal password is
  // permanently exposed in git history). Unset = skip entirely, so a normal
  // boot leaves the existing admin row in the live DB exactly as it is.
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log('  Admin seed skipped (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set)');
    return;
  }

  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (existing) {
    // Do NOT silently overwrite an admin's chosen password or flags on every
    // boot. Only rotate when the operator explicitly opts in (one-time) — e.g.
    // to retire the leaked password. Unset SEED_ADMIN_FORCE_PASSWORD afterward.
    if (process.env.SEED_ADMIN_FORCE_PASSWORD === 'true') {
      const salt = await bcrypt.genSalt(BCRYPT_COST);
      const hash = await bcrypt.hash(password, salt);
      db.prepare("UPDATE users SET password_hash = ?, role = 'admin', is_active = 1 WHERE email = ?").run(hash, email);
      console.log('  Admin password rotated from SEED_ADMIN_PASSWORD:', email);
    }
    return;
  }

  const salt = await bcrypt.genSalt(BCRYPT_COST);
  const hash = await bcrypt.hash(password, salt);
  const id = uuid();
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, role, department, is_active) VALUES (?,?,?,?,?,?,1)"
  ).run(id, email, process.env.SEED_ADMIN_NAME || 'Admin', hash, 'admin', 'Management');
  console.log('  Admin user seeded from env:', email);
}
