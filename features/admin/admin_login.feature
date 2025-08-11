Feature: Admin login to Tidecloak

  Scenario: Login with admin credentials
    Given I open the Tidecloak admin login page
    When I login as admin user
    Then I should see the admin dashboard