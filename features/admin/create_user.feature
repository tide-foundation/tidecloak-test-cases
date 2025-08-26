Feature: Create a new user in testrealm realm
  As a Tide Cloak admin user
  I want to create a user in testrealm
  
  Scenario: Admin creates a new user successfully
    Given the admin is logged in to the Tidecloak admin console
    When the admin creates a user with username <username>. email <email>, first name <first_name> and last name <last_name>
    Then the user tide id, created at and other settings tabs should be visible

  
  Examples:

  | username | email               |  first_name | last_name |
  | user1    | testuser1@gmail.com |  test1      | user1     |