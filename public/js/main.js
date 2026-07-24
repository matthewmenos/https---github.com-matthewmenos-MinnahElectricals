// Mobile menu toggle
const mobileMenuBtn = document.getElementById('mobileMenuBtn');
const mobileMenu = document.getElementById('mobileMenu');

if (mobileMenuBtn && mobileMenu) {
  mobileMenuBtn.addEventListener('click', () => {
    mobileMenu.classList.toggle('hidden');
  });
}

// Close mobile menu when clicking on a link
const mobileLinks = mobileMenu ? mobileMenu.querySelectorAll('a') : [];
mobileLinks.forEach(link => {
  link.addEventListener('click', () => {
    mobileMenu.classList.add('hidden');
  });
});

// Load settings from API and update contact info throughout the page
async function loadSettings() {
  try {
    const response = await fetch('/api/settings');
    const data = await response.json();

    if (response.ok && data.success) {
      const settings = data.settings;

      // Update phone numbers (text content)
      const phoneElements = document.querySelectorAll('[data-setting="phone"]');
      phoneElements.forEach(el => {
        el.textContent = settings.phone || el.textContent;
      });

      // Update phone links (href)
      const phoneLinks = document.querySelectorAll('[data-setting-href="phone"]');
      phoneLinks.forEach(el => {
        const digits = (settings.phone || '').replace(/\D/g, '');
        el.href = 'tel:' + digits;
      });

      // Update email addresses (text content)
      const emailElements = document.querySelectorAll('[data-setting="email"]');
      emailElements.forEach(el => {
        el.textContent = settings.email || el.textContent;
      });

      // Update email links (href)
      const emailLinks = document.querySelectorAll('[data-setting-href="email"]');
      emailLinks.forEach(el => {
        el.href = 'mailto:' + (settings.email || '');
      });

      // Update location/service area (text content)
      const locationElements = document.querySelectorAll('[data-setting="location"]');
      locationElements.forEach(el => {
        el.textContent = settings.location || el.textContent;
      });

      // Update meta description with email/phone if present
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc && settings.phone) {
        const content = metaDesc.getAttribute('content');
        if (content && content.includes('(555) 123-4567')) {
          metaDesc.setAttribute('content', content.replace(/\(555\) 123-4567/g, settings.phone));
        }
      }
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Handle quote form submission
const quoteForm = document.getElementById('quoteForm');
if (quoteForm) {
  quoteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formMessage = document.getElementById('formMessage');
    const submitBtn = quoteForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    // Disable button and show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting...';
    
    // Collect form data
    const formData = new FormData(quoteForm);
    const data = {
      full_name: formData.get('full_name'),
      phone: formData.get('phone'),
      email: formData.get('email'),
      service_needed: formData.get('service_needed'),
      urgency: formData.get('urgency'),
      message: formData.get('message'),
    };
    
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        // Success
        formMessage.className = 'mt-4 p-4 bg-green-50 border border-green-200 rounded-lg';
        formMessage.innerHTML = `
          <div class="flex items-center">
            <svg class="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
            </svg>
            <p class="text-green-800 font-semibold">${result.message}</p>
          </div>
        `;
        formMessage.classList.remove('hidden');
        
        // Reset form
        quoteForm.reset();
        
        // Hide message after 5 seconds
        setTimeout(() => {
          formMessage.classList.add('hidden');
        }, 5000);
      } else {
        // Error
        formMessage.className = 'mt-4 p-4 bg-red-50 border border-red-200 rounded-lg';
        formMessage.innerHTML = `
          <div class="flex items-center">
            <svg class="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
            </svg>
            <p class="text-red-800 font-semibold">${result.message || 'An error occurred. Please try again.'}</p>
          </div>
        `;
        formMessage.classList.remove('hidden');
      }
    } catch (error) {
      // Network error
      formMessage.className = 'mt-4 p-4 bg-red-50 border border-red-200 rounded-lg';
      formMessage.innerHTML = `
        <div class="flex items-center">
          <svg class="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
          </svg>
          <p class="text-red-800 font-semibold">Network error. Please check your connection and try again.</p>
        </div>
      `;
      formMessage.classList.remove('hidden');
    } finally {
      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// Handle contact form submission
const contactForm = document.getElementById('contactForm');
if (contactForm) {
  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const formMessage = document.getElementById('formMessage');
    const submitBtn = contactForm.querySelector('button[type="submit"]');
    const originalText = submitBtn.textContent;
    
    // Disable button and show loading state
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    
    // Collect form data
    const formData = new FormData(contactForm);
    const data = {
      full_name: formData.get('full_name'),
      phone: formData.get('phone'),
      email: formData.get('email'),
      service_needed: formData.get('service_needed'),
      urgency: formData.get('urgency'),
      message: formData.get('message'),
    };
    
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      
      const result = await response.json();
      
      if (response.ok && result.success) {
        // Success
        formMessage.className = 'mt-4 p-4 bg-green-50 border border-green-200 rounded-lg';
        formMessage.innerHTML = `
          <div class="flex items-center">
            <svg class="w-5 h-5 text-green-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd"></path>
            </svg>
            <p class="text-green-800 font-semibold">${result.message}</p>
          </div>
        `;
        formMessage.classList.remove('hidden');
        
        // Reset form
        contactForm.reset();
        
        // Hide message after 5 seconds
        setTimeout(() => {
          formMessage.classList.add('hidden');
        }, 5000);
      } else {
        // Error
        formMessage.className = 'mt-4 p-4 bg-red-50 border border-red-200 rounded-lg';
        formMessage.innerHTML = `
          <div class="flex items-center">
            <svg class="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
            </svg>
            <p class="text-red-800 font-semibold">${result.message || 'An error occurred. Please try again.'}</p>
          </div>
        `;
        formMessage.classList.remove('hidden');
      }
    } catch (error) {
      // Network error
      formMessage.className = 'mt-4 p-4 bg-red-50 border border-red-200 rounded-lg';
      formMessage.innerHTML = `
        <div class="flex items-center">
          <svg class="w-5 h-5 text-red-600 mr-2" fill="currentColor" viewBox="0 0 20 20">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"></path>
          </svg>
          <p class="text-red-800 font-semibold">Network error. Please check your connection and try again.</p>
        </div>
      `;
      formMessage.classList.remove('hidden');
    } finally {
      // Re-enable button
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
}

// Load settings on page load
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
});

console.log('✓ Main JavaScript loaded');
