import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';
import { withTranslation } from 'react-i18next';

// class component라 훅을 못 쓴다 — withTranslation이 t를 prop으로 내려준다.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    const { t } = this.props;
    if (this.state.hasError) {
      return (
        <div className="ErrorBoundary">
          <AlertTriangle className="ErrorBoundary__Icon" size={48} />
          <h2 className="ErrorBoundary__Title">
            {t('common.state.error')}
          </h2>
          <p className="ErrorBoundary__Message">
            {t('layout.errorBoundary.message')}
          </p>
          <button
            className="ErrorBoundary__Button"
            onClick={() => window.location.reload()}
          >
            {t('layout.errorBoundary.refresh')}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default withTranslation()(ErrorBoundary);
