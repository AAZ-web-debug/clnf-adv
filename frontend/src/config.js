const getApiBase = () => {
  if (process.env.REACT_APP_API_BASE) {
    return process.env.REACT_APP_API_BASE.replace(/\/$/, '');
  }
  // Default to local backend during development
  return 'http://localhost:5000';
};

export const API_BASE = getApiBase();
export const API_URL = `${API_BASE}/api`;
