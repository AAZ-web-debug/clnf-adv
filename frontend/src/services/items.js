import { API_URL } from '../config';

export const uploadItem = async (formData) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_URL}/items`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  return response.json();
};

export const getItems = async () => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_URL}/items`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  return response.json();
};
