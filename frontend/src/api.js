import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || '';

const api = axios.create({ baseURL: API_BASE });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Token ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

export default api;

export const auth = {
  login: (username, password) => api.post('/api/auth/login/', { username, password }),
  logout: () => api.post('/api/auth/logout/'),
  me: () => api.get('/api/auth/me/'),
};

export const dashboard = {
  stats: () => api.get('/api/dashboard/'),
};

export const records = {
  list: (params = {}) => api.get('/api/records/', { params }),
  approve: (id) => api.post(`/api/records/${id}/approve/`),
  flag: (id, reason) => api.post(`/api/records/${id}/flag/`, { reason }),
  reject: (id) => api.post(`/api/records/${id}/reject/`),
};

export const ingest = {
  upload: (formData) => api.post('/api/ingest/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  paste: (source_type, raw_data) => api.post('/api/ingest/', { source_type, raw_data }),
};

export const audit = {
  list: () => api.get('/api/audit/'),
};

export const batches = {
  list: () => api.get('/api/batches/'),
};
