// Admin Dashboard JavaScript
let currentToken = localStorage.getItem('adminToken');
let currentFilter = 'all';

// Check authentication on page load
document.addEventListener('DOMContentLoaded', () => {
  const isLoginPage = document.getElementById('loginForm');
  const isDashboardPage = document.getElementById('leadsTableBody');
  
  if (isLoginPage) {
    // On login page
    if (currentToken) {
      // Already logged in, redirect to dashboard
      window.location.href = '/admin/dashboard';
      return;
    }
    setupLoginForm();
  } else if (isDashboardPage) {
    // On dashboard page
    if (!currentToken) {
      // Not logged in, redirect to login
      window.location.href = '/admin/login';
      return;
    }
    setupDashboard();
  }
});

// Login form handler
function setupLoginForm() {
  const loginForm = document.getElementById('loginForm');
  const loginBtn = document.getElementById('loginBtn');
  const loginMessage = document.getElementById('loginMessage');
  
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      
      // Disable button
      loginBtn.disabled = true;
      loginBtn.textContent = 'Signing in...';
      
      try {
        const response = await fetch('/api/admin/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ username, password }),
        });
        
        const result = await response.json();
        
        if (response.ok && result.success) {
          // Store token
          currentToken = result.token;
          localStorage.setItem('adminToken', currentToken);
          
          // Redirect to dashboard
          window.location.href = '/admin/dashboard';
        } else {
          // Show error
          loginMessage.className = 'mt-4 p-4 bg-red-50 border border-red-200 rounded-lg';
          loginMessage.innerHTML = `
            <p class="text-red-800 font-semibold">${result.message || 'Login failed. Please try again.'}</p>
          `;
          loginMessage.classList.remove('hidden');
        }
      } catch (error) {
        loginMessage.className = 'mt-4 p-4 bg-red-50 border border-red-200 rounded-lg';
        loginMessage.innerHTML = `
          <p class="text-red-800 font-semibold">Network error. Please try again.</p>
        `;
        loginMessage.classList.remove('hidden');
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = 'Sign In';
      }
    });
  }
}

// Dashboard setup
function setupDashboard() {
  // Setup logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      currentToken = null;
      localStorage.removeItem('adminToken');
      window.location.href = '/admin/login';
    });
  }
  
  // Setup filter buttons
  const filterBtns = document.querySelectorAll('.filter-btn');
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      filterBtns.forEach(b => {
        b.classList.remove('bg-navy', 'text-white');
        b.classList.add('bg-gray-200', 'text-navy');
      });
      btn.classList.remove('bg-gray-200', 'text-navy');
      btn.classList.add('bg-navy', 'text-white');
      
      // Update filter and fetch leads
      currentFilter = btn.dataset.filter;
      fetchLeads();
    });
  });
  
  // Setup refresh button
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      fetchLeads();
      fetchStats();
    });
  }
  
  // Initial fetch
  fetchStats();
  fetchLeads();
}

// Fetch leads from API
async function fetchLeads() {
  const tableBody = document.getElementById('leadsTableBody');
  const emptyState = document.getElementById('emptyState');
  
  if (!tableBody) return;
  
  try {
    let url = '/api/admin/leads';
    if (currentFilter !== 'all') {
      url += `?status=${currentFilter}`;
    }
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${currentToken}`,
      },
    });
    
    const result = await response.json();
    
    if (response.ok && result.success) {
      if (result.leads.length === 0) {
        tableBody.innerHTML = '';
        emptyState.classList.remove('hidden');
      } else {
        emptyState.classList.add('hidden');
        renderLeads(result.leads);
      }
    } else {
      if (response.status === 401) {
        // Token invalid, redirect to login
        currentToken = null;
        localStorage.removeItem('adminToken');
        window.location.href = '/admin/login';
      }
    }
  } catch (error) {
    console.error('Error fetching leads:', error);
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" class="px-6 py-4 text-center text-red-600">
          Error loading leads. Please try again.
        </td>
      </tr>
    `;
  }
}

// Render leads table
function renderLeads(leads) {
  const tableBody = document.getElementById('leadsTableBody');
  
  tableBody.innerHTML = leads.map(lead => {
    const date = new Date(lead.created_at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
    
    const urgencyClass = lead.urgency === 'Emergency' ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800';
    const statusClass = getStatusClass(lead.status);
    
    return `
      <tr class="hover:bg-gray-50">
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${date}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm font-medium text-navy">${escapeHtml(lead.full_name)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-sm">
          <a href="tel:${lead.phone}" class="text-amber hover:text-amber-dark font-semibold">${escapeHtml(lead.phone)}</a>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm">
          <a href="mailto:${lead.email}" class="text-amber hover:text-amber-dark">${escapeHtml(lead.email)}</a>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-600">${escapeHtml(lead.service_needed)}</td>
        <td class="px-6 py-4 whitespace-nowrap">
          <span class="px-2 py-1 text-xs font-semibold rounded-full ${urgencyClass}">${lead.urgency}</span>
        </td>
        <td class="px-6 py-4 whitespace-nowrap">
          <select onchange="updateLeadStatus(${lead.id}, this.value)" class="text-sm border border-gray-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-amber focus:border-transparent">
            <option value="New" ${lead.status === 'New' ? 'selected' : ''}>New</option>
            <option value="Contacted" ${lead.status === 'Contacted' ? 'selected' : ''}>Contacted</option>
            <option value="Scheduled" ${lead.status === 'Scheduled' ? 'selected' : ''}>Scheduled</option>
            <option value="Completed" ${lead.status === 'Completed' ? 'selected' : ''}>Completed</option>
            <option value="Archived" ${lead.status === 'Archived' ? 'selected' : ''}>Archived</option>
          </select>
        </td>
        <td class="px-6 py-4 whitespace-nowrap text-sm">
          <button onclick="deleteLead(${lead.id})" class="text-red-600 hover:text-red-800 font-semibold">Delete</button>
        </td>
      </tr>
    `;
  }).join('');
}

// Get status badge class
function getStatusClass(status) {
  switch (status) {
    case 'New':
      return 'bg-blue-100 text-blue-800';
    case 'Contacted':
      return 'bg-yellow-100 text-yellow-800';
    case 'Scheduled':
      return 'bg-purple-100 text-purple-800';
    case 'Completed':
      return 'bg-green-100 text-green-800';
    case 'Archived':
      return 'bg-gray-100 text-gray-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

// Update lead status
async function updateLeadStatus(leadId, newStatus) {
  try {
    const response = await fetch(`/api/admin/leads/${leadId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentToken}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });
    
    const result = await response.json();
    
    if (response.ok && result.success) {
      console.log(`✓ Lead #${leadId} status updated to ${newStatus}`);
      fetchStats(); // Refresh stats
    } else {
      alert('Failed to update status. Please try again.');
      fetchLeads(); // Refresh to revert change
    }
  } catch (error) {
    console.error('Error updating lead:', error);
    alert('Error updating status. Please try again.');
    fetchLeads(); // Refresh to revert change
  }
}

// Delete lead
async function deleteLead(leadId) {
  if (!confirm('Are you sure you want to delete this lead? This action cannot be undone.')) {
    return;
  }
  
  try {
    const response = await fetch(`/api/admin/leads/${leadId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${currentToken}`,
      },
    });
    
    const result = await response.json();
    
    if (response.ok && result.success) {
      console.log(`✓ Lead #${leadId} deleted`);
      fetchLeads(); // Refresh list
      fetchStats(); // Refresh stats
    } else {
      alert('Failed to delete lead. Please try again.');
    }
  } catch (error) {
    console.error('Error deleting lead:', error);
    alert('Error deleting lead. Please try again.');
  }
}

// Fetch statistics
async function fetchStats() {
  try {
    const response = await fetch('/api/admin/stats', {
      headers: {
        'Authorization': `Bearer ${currentToken}`,
      },
    });
    
    const result = await response.json();
    
    if (response.ok && result.success) {
      document.getElementById('totalLeads').textContent = result.stats.total;
      document.getElementById('newLeads').textContent = result.stats.byStatus.find(s => s.status === 'New')?.count || 0;
      document.getElementById('recentLeads').textContent = result.stats.recent;
      document.getElementById('emergencyLeads').textContent = result.stats.emergency;
    }
  } catch (error) {
    console.error('Error fetching stats:', error);
  }
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

console.log('✓ Admin JavaScript loaded');