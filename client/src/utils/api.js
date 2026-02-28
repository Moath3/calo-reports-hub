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

    const data = await res.json();

    if (!res.ok) {
      const error = new Error(data.error || 'Request failed');
      error.status = res.status;
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

  // Upload
  async uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    return this.request('/upload', {
      method: 'POST',
      body: formData,
    });
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
  async exportHTML(reportData, brandColor, title, password) {
    const payload = { reportData, brandColor, title };
    if (password) payload.password = password;
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

  async deployNetlify(html, siteName, netlifyToken) {
    return this.request('/export/netlify', {
      method: 'POST',
      body: JSON.stringify({ html, siteName, netlifyToken }),
    });
  }

  // Dashboard
  async getDashboardStats() {
    return this.request('/dashboard/stats');
  }

  // Logout
  logout() {
    this.setToken(null);
  }
}

export const api = new ApiClient();
export default api;
