const eye = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const eyeOff = '<svg viewBox="0 0 24 24" aria-hidden="true" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c6.4 0 10 7 10 7a14 14 0 0 1-3.2 4.1M6.2 6.2C3.5 8 2 12 2 12s3.6 7 10 7a10 10 0 0 0 3-.5"/></svg>';

export function enablePasswordToggles(root: ParentNode = document): void {
  root.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => {
    if (input.dataset.visibilityToggle === 'ready') return;
    input.dataset.visibilityToggle = 'ready';

    let wrapper = input.parentElement;
    if (!wrapper?.classList.contains('input-wrap')) {
      const fieldWrapper = document.createElement('div');
      fieldWrapper.className = 'password-field-wrap';
      fieldWrapper.style.position = 'relative';
      fieldWrapper.style.display = 'block';
      fieldWrapper.style.width = '100%';
      input.parentElement?.insertBefore(fieldWrapper, input);
      fieldWrapper.append(input);
      wrapper = fieldWrapper;
    }

    input.style.width = '100%';
    input.style.paddingRight = '48px';

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'password-visibility-toggle';
    toggle.setAttribute('aria-label', 'Show password');
    toggle.title = 'Show password';
    toggle.innerHTML = eye;
    Object.assign(toggle.style, {
      position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
      display: 'grid', placeItems: 'center', width: '32px', height: '32px', padding: '0',
      border: '0', borderRadius: '4px', background: 'transparent', color: '#777', cursor: 'pointer',
    });

    toggle.addEventListener('click', () => {
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      toggle.setAttribute('aria-label', visible ? 'Hide password' : 'Show password');
      toggle.setAttribute('aria-pressed', String(visible));
      toggle.title = visible ? 'Hide password' : 'Show password';
      toggle.innerHTML = visible ? eyeOff : eye;
      toggle.style.color = visible ? '#222' : '#777';
      input.focus();
    });

    wrapper.append(toggle);
  });
}
