Feature: Create a new user in testrealm realm
  As a Tide Cloak admin user
  I want to create a user in testrealm

  Scenario: Admin creates a new user successfully
    Given the admin in the tide admin console selects realm <realm_name>
    When the admin creates a user with <username>, <email>,  <first_name> and <last_name> in realm
    Then the user tide id, created at and other settings tabs should be visible


    Examples:

      | realm_name | username | email               | first_name | last_name |
      | testrealm  | user1    | testuser1@gmail.com | test1      | user1     |
      | testrealm  | user2    | testuser2@gmail.com | test2      | user2     |