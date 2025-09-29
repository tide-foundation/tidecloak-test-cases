Feature: Add and configure email address for admin user in a realm
  As a tide Cloak admin user
  I want to configure email which will be used to send email
  for different action such as Link tide account, update password
  this test will run only when 'CONFIGURED' value is set to true in dot env

  Scenario: Admin configures a smtp server in realm successfully
    Given the admin selects the <realm_name>
    When the admin enable email verification and configure smtp server with admin username <admin_name>
    Then the verification of smtp configuration done via sending a test mail to email address 

    Examples:

      | realm_name | admin_name |
      | testrealm  | Tide Admin |