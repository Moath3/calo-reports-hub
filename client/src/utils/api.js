const API_BASE = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('calo-token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('calo-token', token);
    } else {
      localStorage.removeItem('calo-token');
    }
  }

  getToken() {
    return this.token;
  }

  async request(path, options = {}) {
    const headers = {
      ...(options.headers || {}),
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    // Don't set Content-Type for FormData (let browser set boundary)
    if (!(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });

    // Handle PDF responses
    if (res.headers.get('content-type')?.includes('application/pdf')) {
      if (!res.ok) throw new Error('PDF generation failed');
      return res.blob();
    }

    // If the upstream proxy / render returns HTML (timeout, 502, etc), JSON.parse
    // chokes with a useless 'Unexpected token <' message. Detect and translate.
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      const isHtml = /<!doctype|<html/i.test(text);
      const error = new Error(
        isHtml
          ? `Server returned HTML instead of JSON (likely a timeout or proxy error). Status ${res.status}.`
          : `Unexpected response (status ${res.status})`
      );
      error.status = res.status;
      throw error;
    }

    const data = await res.json();

    if (!res.ok) {
      const msg = data.detail ? `${data.error || 'Request failed'} — ${data.detail}` : (data.error || 'Request failed');
      const error = new Error(msg);
      error.status = res.status;
      error.detail = data.detail;
      throw error;
    }

    return data;
  }

  // Auth
  async login(email, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async register(fields) {
    const data = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify(fields),
    });
    if (data.token) this.setToken(data.token);
    return data;
  }

  async getMe() {
    return this.request('/auth/me');
  }

  async updateProfile(fields) {
    return this.request('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify(fields),
    });
  }

  async changePassword(currentPassword, newPassword) {
    return this.request('/auth/password', {
      method: 'PUT',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  async getUsers() {
    return this.request('/auth/users');
  }

  async toggleUser(userId) {
    return this.request(`/auth/users/${userId}/toggle`, { method: 'PATCH' });
  }

  async setUserRole(userId, role) {
    return this.request(`/auth/users/${userId}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    });
  }

  // Upload
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request('/upload', {
      method: 'POST',
      body: formData,
    });
  }

  // Diagnostics — admin connectivity check for external integrations
  async testConnections() {
    return this.request('/diagnostics/connections');
  }

  // Time & Attendance — run a per-country overtime report from an attendance
  // export (+ optional HR master files). Returns the structured result plus
  // an Excel workbook as base64.
  async runTimeAttendance(attendanceFile, masterFiles = [], { month, masterSheets, entities } = {}) {
    const fd = new FormData();
    fd.append('attendance', attendanceFile);
    for (const f of masterFiles) fd.append('masters', f);
    if (month) fd.append('month', month);
    if (masterSheets && masterSheets.length) fd.append('masterSheets', JSON.stringify(masterSheets));
    if (entities && entities.length) fd.append('entities', JSON.stringify(entities));
    return this.request('/time-attendance/run', { method: 'POST', body: fd });
  }

  // AI
  async analyzeData(dataSummary, provider, customPrompt, templateId) {
    const payload = { dataSummary, provider, customPrompt };
    if (templateId) payload.templateId = templateId;
    return this.request('/ai/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async chatAI(message, reportContext, provider, history) {
    return this.request('/ai/chat', {
      method: 'POST',
      body: JSON.stringify({ message, reportContext, provider, history }),
    });
  }

  async planChat(history, provider) {
    return this.request('/ai/plan', {
      method: 'POST',
      body: JSON.stringify({ history, provider }),
    });
  }

  async refineSection(reportData, sectionIndex, instruction, provider) {
    return this.request('/ai/refine', {
      method: 'POST',
      body: JSON.stringify({ reportData, sectionIndex, instruction, provider }),
    });
  }

  async getProviders() {
    return this.request('/ai/providers');
  }

  // Reports
  async getReports(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/reports?${query}`);
  }

  async getReport(id) {
    return this.request(`/reports/${id}`);
  }

  async createReport(report) {
    return this.request('/reports', {
      method: 'POST',
      body: JSON.stringify(report),
    });
  }

  async updateReport(id, updates) {
    return this.request(`/reports/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteReport(id) {
    return this.request(`/reports/${id}`, { method: 'DELETE' });
  }

  async updateReportStatus(id, status) {
    return this.request(`/reports/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  }

  async getPublishedReports() {
    return this.request('/reports/shared/all');
  }

  // Templates
  async getTemplates(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/templates?${query}`);
  }

  async getTemplate(id) {
    return this.request(`/templates/${id}`);
  }

  async createTemplate(template) {
    return this.request('/templates', {
      method: 'POST',
      body: JSON.stringify(template),
    });
  }

  async updateTemplate(id, updates) {
    return this.request(`/templates/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    });
  }

  async deleteTemplate(id) {
    return this.request(`/templates/${id}`, { method: 'DELETE' });
  }

  async useTemplate(id) {
    return this.request(`/templates/${id}/use`, { method: 'POST' });
  }

  async getTemplateCategories() {
    return this.request('/templates/categories');
  }

  // Export
  async exportHTML(reportData, brandColor, title, password, variant, tweaks) {
    const payload = { reportData, brandColor, title };
    if (password) payload.password = password;
    if (variant) payload.variant = variant;
    if (tweaks && typeof tweaks === 'object') payload.tweaks = tweaks;
    return this.request('/export/html', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async exportPDF(html) {
    return this.request('/export/pdf', {
      method: 'POST',
      body: JSON.stringify({ html }),
    });
  }

  async deployNetlify(siteName, reportId, options = {}) {
    // Server rebuilds the HTML from the stored report; we only send the
    // styling options (variant/tweaks/password/brandColor/title) + reportId.
    return this.request('/export/netlify', {
      method: 'POST',
      body: JSON.stringify({ siteName, reportId, ...options }),
    });
  }

  async toggleVisibility(id, visibility) {
    return this.request(`/reports/${id}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    });
  }


  async shareReport(id, { visibility, sharedWith }) {
    return this.request(`/reports/${id}/share`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility, sharedWith }),
    });
  }

  async getUsersForShare() {
    return this.request('/auth/users-for-share');
  }

  // Dashboard
  async getDashboardStats() {
    return this.request('/dashboard/stats');
  }

  // Zelt
  async zeltStatus() {
    return this.request('/zelt/status');
  }
  async zeltOauthInit() {
    return this.request('/zelt/oauth/init', { method: 'POST' });
  }
  async zeltDisconnect() {
    return this.request('/zelt/disconnect', { method: 'POST' });
  }
  async zeltEntities() {
    return this.request('/zelt/entities');
  }
  async zeltBalances(entity, asOfDate = null) {
    const params = { entity };
    if (asOfDate) params.asOfDate = asOfDate;
    const q = new URLSearchParams(params).toString();
    return this.request(`/zelt/balances?${q}`);
  }
  async zeltClearCache() {
    return this.request('/zelt/cache/clear', { method: 'POST' });
  }
  async zeltAudit({ force = false } = {}) {
    return this.request('/zelt/audit' + (force ? '?force=1' : ''));
  }

  // Logout
  logout() {
    this.setToken(null);
  }
}

export const api = new ApiClient();
export default api;
