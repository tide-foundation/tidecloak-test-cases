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
- Java runtime 18 or later
- curl
- Optional: Docker, if running a local instance of TideCloak
<!-- - Node.js (for Playwright browsers) -->

## 🔧 Quick Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/tide-foundation/tidecloak-test-cases
   cd tidecloak-test-cases
   ```

2. **Run the setup-environment script**
   ```bash
   chmod +x setup-environment.sh
   # creates python virtual environment and installs required dependecies 
   # downloads allure and installs it if not installed
   ./setup-environment.sh  
   ```

4. **Create dotenv file**
   Depending on where and how you set up your TideCloak server instance, you'll need to adjust this .env file accordingly. This example assumes you're running a local TideCloak-stg-dev instance using this command:
   ```bash
   sudo docker run \
    --name mytidecloak \
    -d \
    -v .:/opt/keycloak/data/h2 \
    -p 8080:8080 \
    -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
    -e KC_BOOTSTRAP_ADMIN_PASSWORD=password \
    tideorg/tidecloak-stg-dev:latest
   ```
   For this local instance, this is how your .env file should be:
   ```bash
   # Sample .env file
   TIDE_INSTANCE_URL="<YOUR_TIDE_DOCKER_INSTANCE_URL>" # Default http://localhost:8080/
   ADMIN_USERNAME="<YOUR_TIDE_ADMIN_USERNAME>" # admin
   ADMIN_PASSWORD="<YOUR_TIDE_ADMIN_PASSWORD>" # password

   # EMAIL CONFIG FOR MAIL DEBUG 
   # SAME EMAIL WILL BE USED FOR TESTING USER INVITE
   CONFIGURED=false # SET CONFIGURED TO 'true' ONCE SMTP IS CONFIGURED. DEFAULT VALUE WILL BE 'false'

   # UUID EMAIL ADDRESS FROM PROJECT ex: 0434f532-e2bf-4627-a111-f1b290afebde@app.debugmail.io
   TEMP_EMAIL_DEBUG_MAIL="<YOUR_MAIL_DEBUG_EMAIL_ADDR_TO_SEND_MAIL>" 
   TEMP_EMAIL_PASSWORD="<YOUR_MAIL_DEBUG_EMAIL_PASSWORD>"
   SMTP_PORT=9025 # SMTP PORT 25 or 9025(FOR MAILDEBUG)
   SMTP_HOST="<YOUR_SMTP_HOST>"

   # YOUR ACCOUNT EMAIL FOR VERYING THE MAIL SENT AND RECEIVED
   # Account used to login into MailDebug and not project email
   MAIL_DEBUG_EMAIL="<YOUR_DEBUG_MAIL_EMAIL_ID>" 
   MAIL_DEBUG_PASSWORD="<YOUR_DEBUG_MAIL_PASSWORD>"
   ```
5. **Change the email address in create_user.feature file**

   To test email invite, you need to change the email in create_user.feature
   ```gherkin
   Feature: Create a new user in testrealm realm
      As a Tide Cloak admin user
      I want to create a user in testrealm

      Scenario: Admin creates a new user successfully
         Given the admin in the tide admin console selects realm <realm_name>
         When the admin creates a user with <username>, <email>,  <first_name> and <last_name> in realm
         Then the user tide id, created at and other settings tabs should be visible
      
      Examples:

         | realm_name | username | email                                     | first_name | last_name |
         | testrealm  | user1    | <YOUR_MAIL_DEBUG_EMAIL_ADDR_TO_SEND_MAIL> | test1      | user1     |
      
   <!-- UUID EMAIL ADDRESS FROM PROJECT ex: 0434f532-e2bf-4627-a111-f1b290afebde@app.debugmail.io -->
   <!-- TEMP_EMAIL_DEBUG_MAIL="<YOUR_MAIL_DEBUG_EMAIL_ADDR_TO_SEND_MAIL>" -->
   ```

## 🎯 Running Tests

### The Easy Way (Recommended)
```bash
# starts tidecloak instance if not running and runs all the test cases
# creates reports and serves the report
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

# Run rich tests and generate reports
pytest -v -s --rich --alluredir=./reports

# Serve the report
allure serve ./reports
```

## 📁 Project Structure

```
tide-cloak-ui-testing/
├── features/                   # BDD feature files
│   ├── admin_login.feature         
│   ├── create_realm.feature     
│   └── get_license.feature      
├── tests/                       # test cases
│   ├── 00_admin_login_test.py          
│   ├── 01_create_realm_test.py         
│   └── 02_get_license_test.py     
├── reports/                     # Generated test reports
├── allure-report.sh             # One-click test execution
├── pytest.ini                   # Pytest configuration
└── requirements.txt             # Python dependencies
```

## 📊 Beautiful Reports

Our Allure integration provides:

- 📈 **Test Execution Trends** - Track your testing progress over time
- 🏷️ **Categorized Results** - Organize tests by features and severity
- 📸 **Screenshots on Failure** - Visual debugging made easy
- ⏱️ **Performance Metrics** - Monitor test execution times
- 📝 **Detailed Steps** - Follow exactly what happened during each test

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

### Step Definitions (Python)
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
```

## 🔍 Key Features

- **🛡️ Environment Safety**: Script validates virtual environment before execution
- **🔄 Automatic Browser Management**: Playwright handles browser lifecycle
- **📱 Cross-Browser Testing**: Test across Chrome, Firefox, Safari, and Edge
- **🐛 Debug-Friendly**: Verbose output and screenshot capture on failures
<!-- - **🎯 Parallel Execution**: Run tests concurrently for faster feedback -->
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
