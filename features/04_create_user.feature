Feature: Create a new user in testrealm realm
  As a Tide Cloak admin user
  I want to create a user in realm

  @user_setup
  Scenario: Admin creates a new user successfully
    Given the admin in the tide admin console selects realm <realm_name>
    When the admin creates a user with <username>, <email>,  <first_name> and <last_name> in realm
    Then the user tide id, created at and other settings tabs should be visible


    Examples:

      | realm_name | username   | email                | first_name | last_name  |
      | testrealm  | adminuser1 | adminuser1@gmail.com | adminuser1 | adminuser1 |
      | testrealm  | adminuser2 | adminuser2@gmail.com | adminuser2 | adminuser2 |
      | testrealm  | adminuser3 | adminuser3@gmail.com | adminuser3 | adminuser3 |
      | testrealm  | adminuser4 | adminuser4@gmail.com | adminuser4 | adminuser4 |
      | testing    | testuser1  | testuser1@gmail.com  | testuser1  | testuser1  |