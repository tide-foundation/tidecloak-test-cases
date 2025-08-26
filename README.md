# 🌊 Tide Cloak UI Testing Suite

[![Tests](https://img.shields.io/badge/tests-pytest--bdd-green)](https://pytest-bdd.readthedocs.io/)
[![Browser](https://img.shields.io/badge/browser-playwright-blue)](https://playwright.dev/python/)
[![Reports](https://img.shields.io/badge/reports-allure-orange)](https://docs.qameta.io/allure/)
[![Python](https://img.shields.io/badge/python-3.8+-brightgreen)](https://www.python.org/)

> **Comprehensive UI testing framework for Tide Cloak using behavior-driven development with beautiful, interactive reports.**

## 🚀 What's Inside

This testing suite combines the power of **pytest-BDD** for readable test scenarios, **Playwright** for robust browser automation, and **Allure** for stunning visual reports. Perfect for ensuring your Tide Cloak application works flawlessly across all user journeys.

### 🛠️ Tech Stack

- **🥒 pytest-BDD**: Write tests in natural language using Gherkin syntax
- **🎭 Playwright**: Fast, reliable end-to-end testing across all browsers
- **📊 Allure**: Generate beautiful, interactive HTML reports
- **🐍 Python**: Clean, maintainable test code
- **⚡ One-Click Execution**: Automated test runs with instant report serving

## 📋 Prerequisites

- Python 3.8 or higher
- Virtual environment (recommended)
- Node.js (for Playwright browsers)
- Allure (for serving reports)

## 🔧 Quick Setup

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd tide-cloak-ui-testing
   ```

2. **Create and activate virtual environment**
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   playwright install
   ```

4. **Create dotenv file**
   ```bash
   # Sample .env file
   ADMIN_URL="<YOUR_TIDE_KEYCLOAK_INSTANCE_URL>"
   ADMIN_USERNAME="<YOUR_ADMIN_USERNAME>"
   ADMIN_PASSWORD="<YOUR_ADMIN_PASSWORD>"
   ```
   
5. **Make the script executable**
   ```bash
   chmod +x allure-report.sh
   ```

## 🎯 Running Tests

### The Easy Way (Recommended)
```bash
./allure-report.sh
```

This magical script will:
- ✅ Verify your virtual environment is active
- 🧪 Run all tests with verbose output
- 📈 Generate comprehensive reports
- 🌐 Automatically serve the Allure report in your browser

### Manual Execution
```bash
# Run tests and generate reports
pytest -v -s --alluredir=./reports

# Serve the report
allure serve ./reports
```

<!-- ## 📁 Project Structure

```
tide-cloak-ui-testing/
├── features/                   # BDD feature files
│   ├── login.feature          # User authentication scenarios
│   ├── navigation.feature     # UI navigation tests
│   └── dashboard.feature      # Dashboard functionality
├── step_definitions/          # Step implementation
│   ├── conftest.py           # Pytest fixtures & config
│   ├── login_steps.py        # Login step definitions
│   └── common_steps.py       # Shared step definitions
├── pages/                     # Page Object Models
│   ├── base_page.py          # Common page elements
│   ├── login_page.py         # Login page interactions
│   └── dashboard_page.py     # Dashboard page methods
├── reports/                   # Generated test reports
├── allure-report.sh          # One-click test execution
├── pytest.ini               # Pytest configuration
└── requirements.txt          # Python dependencies
``` -->

## 📊 Beautiful Reports

Our Allure integration provides:

- 📈 **Test Execution Trends** - Track your testing progress over time
- 🏷️ **Categorized Results** - Organize tests by features and severity
<!-- - 📸 **Screenshots on Failure** - Visual debugging made easy -->
<!-- - ⏱️ **Performance Metrics** - Monitor test execution times -->
<!-- - 📝 **Detailed Steps** - Follow exactly what happened during each test -->

## 🧪 Writing Tests

### Feature Files (Gherkin Syntax)
```gherkin
Feature: Admin login to Tidecloak
   As a Tide Cloak user
   I want to login to my account
   So that I can access the dashboard

   Scenario: Login with admin credentials
      Given I open the Tidecloak admin login page
      When I login as admin user
      Then I should see the admin dashboard
```

<!-- ### Step Definitions (Python)
```python
from pytest_bdd import given, when, then
from playwright.sync_api import expect

@given("I am on the login page")
def navigate_to_login(page, login_page):
    login_page.navigate()

@when("I enter valid username and password")
def enter_credentials(page, login_page):
    login_page.enter_username("user@example.com")
    login_page.enter_password("password123")
``` -->

## 🔍 Key Features

- **🛡️ Environment Safety**: Script validates virtual environment before execution
- **🔄 Automatic Browser Management**: Playwright handles browser lifecycle
- **📱 Cross-Browser Testing**: Test across Chrome, Firefox, Safari, and Edge
<!-- - **🎯 Parallel Execution**: Run tests concurrently for faster feedback -->
<!-- - **🐛 Debug-Friendly**: Verbose output and screenshot capture on failures -->
<!-- - **📋 CI/CD Ready**: Easy integration with GitHub Actions, Jenkins, etc. -->

<!-- ## 🌟 Best Practices

- Keep feature files focused on user behavior, not implementation
- Use Page Object Model for maintainable test code
- Add meaningful tags to organize and filter tests
- Include both positive and negative test scenarios
- Regular cleanup of old report data -->

<!-- ## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-test`)
3. Write your tests following BDD principles
4. Ensure all tests pass locally
5. Submit a pull request -->

<!-- ## 📞 Support

- 🐛 **Issues**: Report bugs or request features via GitHub Issues
- 📚 **Documentation**: Check our [Wiki](link-to-wiki) for detailed guides
- 💬 **Discussions**: Join our community discussions -->

---

**Happy Testing! 🎉** 

*Built with ❤️ for robust UI testing*
