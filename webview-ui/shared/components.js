/**
 * UI Components Bundle
 * This file includes all UI components in a single file for easy loading in webviews
 */

// Base Component class
class Component {
  constructor(className = '') {
    this.element = null;
    this.id = 'component-' + Math.random().toString(36).substr(2, 9);
    this.className = className;
    this.events = new Map();
  }

  createElement(tag, attributes = {}, children = []) {
    const element = document.createElement(tag);
    
    Object.entries(attributes).forEach(([key, value]) => {
      if (key === 'className') {
        element.className = value;
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(element.style, value);
      } else if (key.startsWith('data-')) {
        element.setAttribute(key, value);
      } else if (value !== undefined && value !== null && value !== '') {
        element[key] = value;
      }
    });

    children.forEach(child => {
      if (typeof child === 'string') {
        element.appendChild(document.createTextNode(child));
      } else if (child instanceof HTMLElement) {
        element.appendChild(child);
      }
    });

    return element;
  }

  on(event, handler) {
    this.events.set(event, handler);
    if (this.element) {
      this.element.addEventListener(event, handler);
    }
  }

  // Attach all stored events to the current element
  attachEvents() {
    if (this.element) {
      this.events.forEach((handler, event) => {
        this.element.addEventListener(event, handler);
      });
    }
  }

  off(event) {
    const handler = this.events.get(event);
    if (handler && this.element) {
      this.element.removeEventListener(event, handler);
    }
    this.events.delete(event);
  }

  update(options) {
    if (options) {
      Object.assign(this.options || {}, options);
    }
    if (this.element && this.element.parentElement) {
      const parent = this.element.parentElement;
      const newElement = this.render();
      parent.replaceChild(newElement, this.element);
      this.element = newElement;
    }
  }

  render() {
    throw new Error('render() must be implemented by subclass');
  }

  mount(parent) {
    if (typeof parent === 'string') {
      parent = document.querySelector(parent);
    }
    if (!this.element) {
      this.element = this.render();
    }
    if (parent) {
      parent.appendChild(this.element);
    }
  }

  destroy() {
    this.events.forEach((handler, event) => {
      if (this.element) {
        this.element.removeEventListener(event, handler);
      }
    });
    this.events.clear();
    if (this.element && this.element.parentElement) {
      this.element.parentElement.removeChild(this.element);
    }
    this.element = null;
  }
}

// Button component
class Button extends Component {
  constructor(options = {}) {
    super();
    this.options = {
      text: '',
      variant: 'primary',
      size: 'md',
      disabled: false,
      loading: false,
      icon: null,
      iconPosition: 'left',
      ...options
    };
    if (options.onClick) {
      this.on('click', () => {
        if (!this.options.disabled && !this.options.loading) {
          options.onClick();
        }
      });
    }
  }

  render() {
    const classes = [
      'vscode-button',
      `vscode-button--${this.options.variant}`,
      `vscode-button--${this.options.size}`
    ];

    if (this.options.disabled) classes.push('vscode-button--disabled');
    if (this.options.loading) classes.push('vscode-button--loading');

    const children = [];
    
    if (this.options.icon && this.options.iconPosition !== 'right') {
      children.push(this.createElement('span', {
        className: 'vscode-button__icon vscode-button__icon--left'
      }, [this.options.icon]));
    }
    
    children.push(this.createElement('span', {
      className: 'vscode-button__text',
      style: { visibility: this.options.loading ? 'hidden' : 'visible' }
    }, [this.options.text]));
    
    if (this.options.icon && this.options.iconPosition === 'right') {
      children.push(this.createElement('span', {
        className: 'vscode-button__icon vscode-button__icon--right'
      }, [this.options.icon]));
    }

    if (this.options.loading) {
      children.push(this.createElement('span', {
        className: 'vscode-button__spinner'
      }));
    }

    this.element = this.createElement('button', {
      className: classes.join(' '),
      disabled: this.options.disabled || this.options.loading,
      type: 'button'
    }, children);

    // Attach any stored event handlers
    this.attachEvents();

    return this.element;
  }

  setLoading(loading) {
    this.options.loading = loading;
    this.update();
  }

  setText(text) {
    this.options.text = text;
    this.update();
  }

  setDisabled(disabled) {
    this.options.disabled = disabled;
    this.update();
  }
}

// Input component
class Input extends Component {
  constructor(options = {}) {
    super();
    this.options = {
      type: 'text',
      placeholder: '',
      value: '',
      disabled: false,
      readonly: false,
      required: false,
      error: false,
      errorMessage: '',
      icon: null,
      iconPosition: 'left',
      ...options
    };
    this.inputElement = null;
  }

  render() {
    const wrapper = this.createElement('div', { className: 'vscode-input-wrapper' });

    if (this.options.icon) {
      const iconElement = this.createElement('span', {
        className: `vscode-input__icon vscode-input__icon--${this.options.iconPosition}`
      }, [this.options.icon]);
      wrapper.appendChild(iconElement);
    }

    const inputClasses = ['vscode-input'];
    if (this.options.error) inputClasses.push('vscode-input--error');
    if (this.options.icon && this.options.iconPosition === 'left') {
      inputClasses.push('vscode-input--with-icon-left');
    }
    if (this.options.icon && this.options.iconPosition === 'right') {
      inputClasses.push('vscode-input--with-icon-right');
    }

    this.inputElement = this.createElement('input', {
      type: this.options.type,
      className: inputClasses.join(' '),
      placeholder: this.options.placeholder || '',
      value: this.options.value || '',
      disabled: this.options.disabled,
      readonly: this.options.readonly,
      required: this.options.required,
      min: this.options.min,
      max: this.options.max
    });

    this.inputElement.addEventListener('input', (e) => {
      this.options.value = e.target.value;
      if (this.options.onChange) {
        this.options.onChange(e.target.value);
      }
    });

    this.inputElement.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && this.options.onEnter) {
        this.options.onEnter(e.target.value);
      }
    });

    wrapper.appendChild(this.inputElement);

    if (this.options.error && this.options.errorMessage) {
      const errorElement = this.createElement('div', {
        className: 'vscode-input__error'
      }, [this.options.errorMessage]);
      wrapper.appendChild(errorElement);
    }

    this.element = wrapper;
    
    // Attach any stored event handlers
    this.attachEvents();
    
    return wrapper;
  }

  getValue() {
    return this.inputElement?.value || '';
  }

  setValue(value) {
    this.options.value = value;
    if (this.inputElement) {
      this.inputElement.value = value;
    }
  }

  setError(error, message) {
    this.options.error = error;
    this.options.errorMessage = message || '';
    this.update();
  }

  clear() {
    this.setValue('');
  }

  focus() {
    this.inputElement?.focus();
  }
}

// Select component
class Select extends Component {
  constructor(options = {}) {
    super();
    this.options = {
      options: [],
      value: '',
      placeholder: '',
      disabled: false,
      error: false,
      ...options
    };
    this.selectElement = null;
  }

  render() {
    const wrapper = this.createElement('div', { className: 'vscode-select-wrapper' });

    const selectClasses = ['vscode-select'];
    if (this.options.error) selectClasses.push('vscode-select--error');

    this.selectElement = this.createElement('select', {
      className: selectClasses.join(' '),
      disabled: this.options.disabled,
      value: this.options.value || ''
    });

    if (this.options.placeholder) {
      const placeholderOption = this.createElement('option', {
        value: '',
        disabled: true,
        selected: !this.options.value
      }, [this.options.placeholder]);
      this.selectElement.appendChild(placeholderOption);
    }

    this.options.options.forEach(opt => {
      const option = this.createElement('option', {
        value: opt.value,
        disabled: opt.disabled
      }, [opt.label]);
      this.selectElement.appendChild(option);
    });

    this.selectElement.addEventListener('change', (e) => {
      this.options.value = e.target.value;
      if (this.options.onChange) {
        this.options.onChange(e.target.value);
      }
    });

    wrapper.appendChild(this.selectElement);
    this.element = wrapper;
    
    // Attach any stored event handlers
    this.attachEvents();
    
    return wrapper;
  }

  getValue() {
    return this.selectElement?.value || '';
  }

  setValue(value) {
    this.options.value = value;
    if (this.selectElement) {
      this.selectElement.value = value;
    }
  }

  setDisabled(disabled) {
    this.options.disabled = disabled;
    if (this.selectElement) {
      this.selectElement.disabled = disabled;
    }
  }
}

// Checkbox component
class Checkbox extends Component {
  constructor(options = {}) {
    super();
    this.options = {
      label: '',
      checked: false,
      disabled: false,
      ...options
    };
    this.inputElement = null;
  }

  render() {
    const label = this.createElement('label', { className: 'vscode-checkbox' });

    this.inputElement = this.createElement('input', {
      type: 'checkbox',
      className: 'vscode-checkbox__input',
      checked: this.options.checked,
      disabled: this.options.disabled
    });

    this.inputElement.addEventListener('change', (e) => {
      this.options.checked = e.target.checked;
      if (this.options.onChange) {
        this.options.onChange(e.target.checked);
      }
    });

    label.appendChild(this.inputElement);

    const box = this.createElement('span', { className: 'vscode-checkbox__box' });
    label.appendChild(box);

    if (this.options.label) {
      const labelText = this.createElement('span', {
        className: 'vscode-checkbox__label'
      }, [this.options.label]);
      label.appendChild(labelText);
    }

    this.element = label;
    
    // Attach any stored event handlers
    this.attachEvents();
    
    return label;
  }

  isChecked() {
    return this.inputElement?.checked || false;
  }

  setChecked(checked) {
    this.options.checked = checked;
    if (this.inputElement) {
      this.inputElement.checked = checked;
    }
  }

  toggle() {
    this.setChecked(!this.isChecked());
  }
}

// Progress component
class Progress extends Component {
  constructor(options = {}) {
    super();
    this.options = {
      value: 0,
      max: 100,
      label: '',
      variant: 'default',
      indeterminate: false,
      ...options
    };
    this.progressBar = null;
  }

  render() {
    const wrapper = this.createElement('div', { className: 'vscode-progress-wrapper' });

    if (this.options.label) {
      const label = this.createElement('div', {
        className: 'vscode-progress-label'
      }, [this.options.label]);
      wrapper.appendChild(label);
    }

    const container = this.createElement('div', {
      className: 'vscode-progress-container'
    });

    const barClasses = ['vscode-progress-bar'];
    if (this.options.variant !== 'default') {
      barClasses.push(`vscode-progress-bar--${this.options.variant}`);
    }
    if (this.options.indeterminate) {
      barClasses.push('vscode-progress-bar--indeterminate');
    }

    const percentage = Math.min(100, Math.max(0, (this.options.value / this.options.max) * 100));
    
    this.progressBar = this.createElement('div', {
      className: barClasses.join(' '),
      style: this.options.indeterminate ? {} : { width: `${percentage}%` }
    });

    container.appendChild(this.progressBar);
    wrapper.appendChild(container);

    this.element = wrapper;
    
    // Attach any stored event handlers
    this.attachEvents();
    
    return wrapper;
  }

  setValue(value) {
    this.options.value = value;
    if (this.progressBar && !this.options.indeterminate) {
      const percentage = Math.min(100, Math.max(0, (value / this.options.max) * 100));
      this.progressBar.style.width = `${percentage}%`;
    }
  }

  setIndeterminate(indeterminate) {
    this.options.indeterminate = indeterminate;
    this.update();
  }

  setLabel(label) {
    this.options.label = label;
    this.update();
  }
}

// Card component
class Card extends Component {
  constructor(options = {}) {
    super();
    this.options = {
      title: '',
      subtitle: '',
      content: null,
      footer: null,
      variant: 'default',
      hoverable: false,
      clickable: false,
      selected: false,
      ...options
    };
    if (options.onClick && options.clickable) {
      this.on('click', () => {
        options.onClick();
      });
    }
  }

  render() {
    const classes = ['vscode-card'];
    if (this.options.variant !== 'default') {
      classes.push(`vscode-card--${this.options.variant}`);
    }
    if (this.options.hoverable) classes.push('vscode-card--hoverable');
    if (this.options.clickable) classes.push('vscode-card--clickable');
    if (this.options.selected) classes.push('vscode-card--selected');

    const children = [];

    if (this.options.title || this.options.subtitle) {
      const header = this.createElement('div', { className: 'vscode-card__header' });
      
      if (this.options.title) {
        header.appendChild(this.createElement('h3', {
          className: 'vscode-card__title'
        }, [this.options.title]));
      }
      
      if (this.options.subtitle) {
        header.appendChild(this.createElement('div', {
          className: 'vscode-card__subtitle'
        }, [this.options.subtitle]));
      }
      
      children.push(header);
    }

    if (this.options.content) {
      const body = this.createElement('div', { className: 'vscode-card__body' });
      if (typeof this.options.content === 'string') {
        body.innerHTML = this.options.content;
      } else {
        body.appendChild(this.options.content);
      }
      children.push(body);
    }

    if (this.options.footer) {
      const footer = this.createElement('div', { className: 'vscode-card__footer' });
      if (typeof this.options.footer === 'string') {
        footer.innerHTML = this.options.footer;
      } else {
        footer.appendChild(this.options.footer);
      }
      children.push(footer);
    }

    this.element = this.createElement('div', {
      className: classes.join(' ')
    }, children);

    // Attach any stored event handlers
    this.attachEvents();

    return this.element;
  }

  setTitle(title) {
    this.options.title = title;
    this.update();
  }

  setContent(content) {
    this.options.content = content;
    this.update();
  }

  setFooter(footer) {
    this.options.footer = footer;
    this.update();
  }

  setSelected(selected) {
    this.options.selected = selected;
    this.update();
  }
}

class CardActions extends Component {
  constructor(alignment = 'right') {
    super();
    this.alignment = alignment;
    this.buttons = [];
  }

  addButton(button) {
    this.buttons.push(button);
    if (this.element) {
      this.element.appendChild(button);
    }
  }

  render() {
    const classes = ['vscode-card__actions'];
    if (this.alignment !== 'left') {
      classes.push(`vscode-card__actions--${this.alignment}`);
    }

    this.element = this.createElement('div', {
      className: classes.join(' ')
    }, this.buttons);

    // Attach any stored event handlers
    this.attachEvents();

    return this.element;
  }
}

// Factory functions
function createButton(options) {
  return new Button(options);
}

function createInput(options) {
  return new Input(options);
}

function createSelect(options) {
  return new Select(options);
}

function createCheckbox(options) {
  return new Checkbox(options);
}

function createProgress(options) {
  return new Progress(options);
}

function createCard(options) {
  return new Card(options);
}

function createCardActions(alignment) {
  return new CardActions(alignment);
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
  window.UIComponents = {
    Component,
    Button,
    Input,
    Select,
    Checkbox,
    Progress,
    Card,
    CardActions,
    createButton,
    createInput,
    createSelect,
    createCheckbox,
    createProgress,
    createCard,
    createCardActions
  };
}