Feature: Admin sets default password for user in testrealm realm
  As a Tide Cloak admin user
  I want to set default password for user in testrealm
  
  Scenario: Admin sets default password for user successfully
    Given the admin is logged in to the Tidecloak admin console
    When the admin sets default password <password> for user <username>
    Then the user should

  
  Examples:

  | username | password     |
  | user1    | password1    | 