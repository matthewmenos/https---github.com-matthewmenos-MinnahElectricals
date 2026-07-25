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

// WhatsApp floating button
let whatsappButton = null;

function createWhatsAppButton(phoneNumber) {
  // Remove existing button if present
  if (whatsappButton) {
    whatsappButton.remove();
  }

  // Create WhatsApp button
  whatsappButton = document.createElement('a');
  whatsappButton.href = `https://wa.me/${phoneNumber}`;
  whatsappButton.target = '_blank';
  whatsappButton.rel = 'noopener noreferrer';
  whatsappButton.className = 'fixed bottom-6 right-6 z-40 bg-green-500 hover:bg-green-600 text-white rounded-full p-4 shadow-lg transition-all duration-300 hover:scale-110 flex items-center justify-center';
  whatsappButton.innerHTML = `
    <svg class="w-8 h-8" viewBox="0 0 24 24" fill="currentColor">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
    </svg>
  `;
  whatsappButton.setAttribute('aria-label', 'Chat on WhatsApp');
  whatsappButton.title = 'Chat with us on WhatsApp';

  // Add animation
  const style = document.createElement('style');
  style.textContent = `
    @keyframes whatsapp-pulse {
      0% { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0.7); }
      70% { box-shadow: 0 0 0 15px rgba(37, 211, 102, 0); }
      100% { box-shadow: 0 0 0 0 rgba(37, 211, 102, 0); }
    }
    .whatsapp-pulse {
      animation: whatsapp-pulse 2s infinite;
    }
  `;
  document.head.appendChild(style);
  whatsappButton.classList.add('whatsapp-pulse');

  document.body.appendChild(whatsappButton);
}

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

      // Create WhatsApp button if WhatsApp number is configured
      if (settings.whatsapp && settings.whatsapp.trim() !== '') {
        const whatsappNumber = settings.whatsapp.replace(/\D/g, '');
        if (whatsappNumber) {
          createWhatsAppButton(whatsappNumber);
        }
      }

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
